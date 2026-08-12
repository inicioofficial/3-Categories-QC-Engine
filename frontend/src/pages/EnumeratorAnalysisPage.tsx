import { useEffect, useMemo, useState } from "react";
import { Award, Download } from "lucide-react";
import { Link } from "react-router-dom";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ScrollableTable,
  ScrollableTableHeader,
  ScrollableTableBody,
  ScrollableTableRow,
  ScrollableTableHead,
  ScrollableTableCell,
} from "@/components/ui/ScrollableTable";
import { apiFetch } from "@/lib/api";
import { useSortedTable } from "@/hooks/useSortedTable";

interface EnumeratorStat {
  enumerator_id: string;
  enumerator_name: string;
  total_cases: number;
  approved_count: number;
  rejected_count: number;
  pending_count: number;
  consent_obtained: number;
  consent_refused: number;
  avg_duration_minutes: number;
  avg_sections_completed: number;
  open_issues: number;
  total_issues?: number;
  [key: string]: string | number | undefined;
}


interface EnumeratorProductivityByDatePayload {
  dates: string[];
  items: Array<{
    enumerator_id: string;
    enumerator_name?: string;
    counts: Record<string, number>;
  }>;
}

const QC_RULES = [
  { code: "MAIN_LOW_LOI", label: "Low LOI", sev: "high", threshold: "< 50% median LOI", desc: "Interviews completed significantly faster than the expected median/benchmark time." },
  { code: "MAIN_HIGH_LOI", label: "High LOI", sev: "high", threshold: "> 150% median LOI", desc: "Interviews taking significantly longer than expected." },
  { code: "MAIN_START_TIME", label: "Odd Hour", sev: "high", threshold: "7:00 PM–6:59 AM", desc: "Timestamp when the interview begins." },
  { code: "MAIN_DUPLICATE_PHONE_NUMBER", label: "Duplicate Phone Number", sev: "high", threshold: "duplicate phone", desc: "Same phone number used across multiple interviews for the same interviewer." },
  { code: "MAIN_DUPLICATE_GPS", label: "Duplicate GPS", sev: "high", threshold: "exact GPS match", desc: "Multiple interviews conducted at identical GPS coordinates." },
  { code: "MAIN_GAP_BETWEEN_2_INTERVIEWS", label: "Gap between 2 interviews", sev: "high", threshold: "gap < 5 minutes", desc: "Time difference between consecutive interviews by the same interviewer." },
  { code: "MAIN_TIME_INTERWOVEN", label: "Time interwoven", sev: "high", threshold: "overlap > 1 minute", desc: "Overlapping interview times by the same interviewer." },
  { code: "MAIN_ENUMERATOR_MATRIX_ANOMALY", label: "Enumerator Matrix Anomaly", sev: "high", threshold: "Dominant gender/age/sector/panel pattern", desc: "Interviewer-level respondent profile or selected-panel distribution is unusually concentrated." },
];

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type PerformanceGroupMode = "enumerator" | "city";

function explorerQcRuleUrl(groupId: string, ruleCode: string, groupMode: PerformanceGroupMode) {
  const params = new URLSearchParams({ qc_rule: ruleCode });
  params.set(groupMode === "city" ? "cities" : "interviewers", groupId);
  return `/main/cases?${params.toString()}`;
}

function normalizeEnumeratorStat(row: EnumeratorStat): EnumeratorStat {
  const normalized: EnumeratorStat = { ...row };
  normalized.total_cases = toNumber(row.total_cases);
  normalized.approved_count = toNumber(row.approved_count);
  normalized.rejected_count = toNumber(row.rejected_count);
  normalized.pending_count = toNumber(row.pending_count);
  normalized.consent_obtained = toNumber(row.consent_obtained);
  normalized.consent_refused = toNumber(row.consent_refused);
  normalized.avg_duration_minutes = toNumber(row.avg_duration_minutes);
  normalized.avg_sections_completed = toNumber(row.avg_sections_completed);
  normalized.open_issues = toNumber(row.open_issues);
  normalized.total_issues = toNumber(row.total_issues);
  for (const key of Object.keys(normalized)) {
    if (key.startsWith("main_")) {
      normalized[key] = toNumber(normalized[key]);
    }
  }
  return normalized;
}


function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const ISSUE_RATE_TONE = (rate: number) => {
  if (rate < 5) return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Good" };
  if (rate < 15) return { cls: "bg-amber-50 text-amber-700 border-amber-200", label: "Fair" };
  return { cls: "bg-rose-50 text-rose-700 border-rose-200", label: "Poor" };
};

const SYNTHETIC_ENUMERATOR_STATS: EnumeratorStat[] = Array.from({ length: 10 }, (_, index) => {
  const totalCases = 160 + index * 11;
  const openIssues = index % 4 === 0 ? 18 : index % 3 === 0 ? 11 : 5 + index;
  const row: EnumeratorStat = {
    enumerator_id: `enum_${String(index + 1).padStart(3, "0")}`,
    enumerator_name: `Enumerator ${String(index + 1).padStart(3, "0")}`,
    total_cases: totalCases,
    approved_count: Math.round(totalCases * 0.72),
    rejected_count: Math.round(totalCases * 0.07),
    pending_count: totalCases - Math.round(totalCases * 0.79),
    consent_obtained: Math.round(totalCases * 0.91),
    consent_refused: Math.round(totalCases * 0.04),
    avg_duration_minutes: 41 + (index % 6),
    avg_sections_completed: 20 + (index % 5),
    open_issues: openIssues,
    total_issues: openIssues + 12 + index,
  };
  QC_RULES.forEach((rule, ruleIndex) => {
    row[rule.code.toLowerCase()] = (index + ruleIndex) % 6 === 0 ? 1 + ((index + ruleIndex) % 5) : 0;
  });
  return row;
});

const SYNTHETIC_ENUMERATOR_BY_DATE: EnumeratorProductivityByDatePayload = {
  dates: ["2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11", "2026-04-12"],
  items: SYNTHETIC_ENUMERATOR_STATS.map((row, index) => ({
    enumerator_id: row.enumerator_id,
    counts: {
      "2026-04-08": 28 + (index % 6),
      "2026-04-09": 31 + (index % 5),
      "2026-04-10": 26 + (index % 7),
      "2026-04-11": 24 + (index % 4),
      "2026-04-12": 22 + (index % 8),
    },
  })),
};

export function EnumeratorAnalysisPage() {
  const { token } = useAuth();
  const [groupMode, setGroupMode] = useState<PerformanceGroupMode>("enumerator");
  const [items, setItems] = useState<EnumeratorStat[]>([]);
  const [productivityByDate, setProductivityByDate] = useState<EnumeratorProductivityByDatePayload>({ dates: [], items: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const query = new URLSearchParams({ group_by: groupMode });
        const [statsPayload, productivityPayload] = await Promise.all([
          apiFetch<{ items: EnumeratorStat[] }>(`/api/main-survey/enumerator-stats?${query.toString()}`, {}, token, 60_000),
          apiFetch<EnumeratorProductivityByDatePayload>(`/api/main-survey/enumerator-productivity-by-date?${query.toString()}`, {}, token, 60_000),
        ]);
        setItems((statsPayload.items ?? []).map(normalizeEnumeratorStat));
        setProductivityByDate({
          dates: productivityPayload.dates ?? [],
          items: productivityPayload.items ?? [],
        });
        setError(null);
      } catch (err) {
        setItems([]);
        setProductivityByDate({ dates: [], items: [] });
        setError(err instanceof Error ? err.message : "Failed to load enumerator performance data.");
      }
    }
    void load();
  }, [groupMode, token]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, row) => {
        acc.enumerators += 1;
        acc.totalCases += row.total_cases;
        acc.approved += row.approved_count;
        acc.consentObtained += row.consent_obtained;
        acc.openIssues += row.open_issues;
        acc.totalIssues += toNumber(row.total_issues);
        acc.durationSum += toNumber(row.avg_duration_minutes) * row.total_cases;
        return acc;
      },
      { enumerators: 0, totalCases: 0, approved: 0, consentObtained: 0, openIssues: 0, totalIssues: 0, durationSum: 0 },
    );
  }, [items]);

  const averageInterviews = totals.enumerators > 0 ? Math.round(totals.totalCases / totals.enumerators) : 0;
  const averageDuration = totals.totalCases > 0 ? totals.durationSum / totals.totalCases : 0;
  const groupLabel = groupMode === "city" ? "City" : "Enumerator";
  const groupLabelPlural = groupMode === "city" ? "Cities" : "Interviewers";
  const { sorted: sortedItems, sortKey, sortDir, handleSort } = useSortedTable(items ?? []);
  const enumeratorNameById = useMemo(() => {
    const lookup = new Map<string, string>();
    items.forEach((item) => lookup.set(item.enumerator_id, item.enumerator_name || item.enumerator_id));
    return lookup;
  }, [items]);

  const [matrixSortKey, setMatrixSortKey] = useState<string>("enumerator_id");
  const [matrixSortDir, setMatrixSortDir] = useState<"asc" | "desc">("asc");

  const sortedProductivityRows = useMemo(() => {
    const rows = [...productivityByDate.items];
    rows.sort((left, right) => {
      const leftTotal = productivityByDate.dates.reduce((sum, date) => sum + Number(left.counts?.[date] ?? 0), 0);
      const rightTotal = productivityByDate.dates.reduce((sum, date) => sum + Number(right.counts?.[date] ?? 0), 0);
      const leftValue = matrixSortKey === "enumerator_id" ? (enumeratorNameById.get(left.enumerator_id) ?? left.enumerator_id) : matrixSortKey === "total" ? leftTotal : Number(left.counts?.[matrixSortKey] ?? 0);
      const rightValue = matrixSortKey === "enumerator_id" ? (enumeratorNameById.get(right.enumerator_id) ?? right.enumerator_id) : matrixSortKey === "total" ? rightTotal : Number(right.counts?.[matrixSortKey] ?? 0);
      const result = typeof leftValue === "string" && typeof rightValue === "string"
        ? leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" })
        : Number(leftValue) - Number(rightValue);
      return matrixSortDir === "asc" ? result : -result;
    });
    return rows;
  }, [enumeratorNameById, productivityByDate.dates, productivityByDate.items, matrixSortDir, matrixSortKey]);

  const handleMatrixSort = (key: string) => {
    if (matrixSortKey === key) {
      setMatrixSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setMatrixSortKey(key);
    setMatrixSortDir(key === "enumerator_id" ? "asc" : "desc");
  };

  const exportMetrics = () => {
    const headers = [
      groupLabel,
      "Cases",
      "Approved",
      "Avg Duration",
      "Open Issues",
      "Quality Score",
      ...QC_RULES.map((rule) => rule.label),
    ];
    const rows = sortedItems.map((row) => {
      const issueRate = toNumber(row.total_cases) > 0 ? Math.round((toNumber(row.open_issues) / toNumber(row.total_cases)) * 100) : 0;
      const qualityScore = Math.max(0, 100 - issueRate);
      return [
        row.enumerator_name || row.enumerator_id,
        row.total_cases,
        row.approved_count,
        toNumber(row.avg_duration_minutes) > 0 ? toNumber(row.avg_duration_minutes).toFixed(1) : "—",
        row.open_issues,
        `${qualityScore}%`,
        ...QC_RULES.map((rule) => Number(row[rule.code.toLowerCase()] ?? 0)),
      ];
    });
    downloadCsv(`main-${groupMode}-productivity-quality.csv`, headers, rows);
  };

  const exportProductivityByDate = () => {
    const headers = [groupLabel, "Total interviews", ...productivityByDate.dates];
    const rows = sortedProductivityRows.map((row) => [
      enumeratorNameById.get(row.enumerator_id) ?? row.enumerator_id,
      productivityByDate.dates.reduce((sum, date) => sum + Number(row.counts?.[date] ?? 0), 0),
      ...productivityByDate.dates.map((date) => Number(row.counts?.[date] ?? 0)),
    ]);
    downloadCsv(`main-${groupMode}-productivity-by-date.csv`, headers, rows);
  };

  return (
    <PlatformPage
      title="Enumerator Performance"
      subtitle=""
      syncLabel=""
      module="main"
    >
      <div className="space-y-6">
        <KpiStrip items={[
          { label: groupLabelPlural, value: totals.enumerators.toLocaleString("en-US"), tone: "blue" },
          { label: "Total interviews", value: totals.totalCases.toLocaleString("en-US"), tone: "blue" },
          { label: `Avg interviews / ${groupMode === "city" ? "city" : "interviewer"}`, value: averageInterviews.toLocaleString("en-US"), tone: "emerald" },
          { label: "Avg duration", value: averageDuration > 0 ? `${averageDuration.toFixed(1)} min` : "-", tone: "amber" },
        ]} />

        <div className="flex flex-wrap items-center justify-start gap-2">
          <div className="inline-flex rounded-[1.1rem] border border-white/70 bg-white/80 p-1 text-xs font-bold shadow-sm">
            {(["enumerator", "city"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setGroupMode(mode)}
                className={`rounded-[0.9rem] px-4 py-2 capitalize transition ${
                  groupMode === mode ? "bg-blue-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {mode === "city" ? "City" : "Enumerator"}
              </button>
            ))}
          </div>
        </div>

        <ExpandableSection
          title="QC Flags Definition"
          storageKey="qc-flags-definition-enumerator-v2"
          defaultExpanded={false}
          className="hidden glass-panel rounded-[1.8rem] border-white/70"
          headerClassName="px-5 py-4"
        >
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-black">QC Flags Definition</p>
                <p className="mt-0.5 text-xs text-black">{QC_RULES.length} QC rules tracked automatically</p>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="rounded px-2 py-1 bg-red-100 text-red-700 font-bold uppercase tracking-wider">Critical</span>
                <span className="rounded px-2 py-1 bg-rose-100 text-rose-700 font-bold uppercase tracking-wider">High</span>
                <span className="rounded px-2 py-1 bg-amber-100 text-amber-700 font-bold uppercase tracking-wider">Medium</span>
              </div>
            </div>

            <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
              {QC_RULES.map((rule) => (
                <div key={rule.code} className="flex flex-col gap-1.5 rounded-xl border border-slate-200/60 bg-white/50 p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[9px] font-bold text-black leading-snug break-all">{rule.code}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                      rule.sev === "critical" ? "bg-red-100 text-red-700" : rule.sev === "high" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {rule.sev}
                    </span>
                  </div>
                  <span className="text-black leading-snug font-medium text-[11px]">{rule.label}</span>
                  <span className="text-black leading-snug text-[11px]">{rule.desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </ExpandableSection>

        <ExpandableSection
          title={`Per-${groupMode} productivity & quality metrics`}
          storageKey="enumerator-metrics-v2"
          defaultExpanded={false}
          className="glass-panel rounded-[1.8rem] border-white/70"
          headerClassName="px-5 py-4"
          contentClassName="p-0"
        >
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/60 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Enumerator Breakdown</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Per-{groupMode} productivity & quality metrics</h3>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                  {totals.enumerators} {groupLabelPlural.toLowerCase()}
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportMetrics}>
                  <Download className="h-4 w-4" /> Export
                </Button>
              </div>
            </div>

            <div className="min-w-0 overflow-x-scroll pb-3">
              <div className="max-h-[500px] overflow-y-auto">
              <Table className="min-w-[1680px]">
              <TableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm shadow-[0_2px_4px_rgba(0,0,0,0.08)] [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:top-0 [&_th:first-child]:z-30 [&_th:first-child]:min-w-[240px] [&_th:first-child]:border-r [&_th:first-child]:border-slate-200 [&_th:first-child]:bg-white/95 [&_th:first-child]:text-slate-700 [&_th:first-child]:shadow-[2px_0_4px_rgba(15,23,42,0.06)]">
                <TableRow className="h-12 border-b border-white/60 bg-white/20">
                  <TableHead className="cursor-pointer text-slate-600" onClick={() => handleSort("enumerator_name")}>{groupLabel} {sortKey === "enumerator_name" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("total_cases")}>Cases {sortKey === "total_cases" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("approved_count")}>Approved {sortKey === "approved_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("avg_duration_minutes")}>Avg Duration {sortKey === "avg_duration_minutes" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("open_issues")}>Open Issues {sortKey === "open_issues" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("total_issues")}>Quality Score {sortKey === "total_issues" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  {QC_RULES.map((rule) => (
                    <TableHead key={rule.code} className="min-w-[90px] cursor-pointer whitespace-nowrap text-right text-slate-600" onClick={() => handleSort(rule.code.toLowerCase() as keyof EnumeratorStat)}>
                      {rule.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-10 [&_td:first-child]:min-w-[240px] [&_td:first-child]:border-r [&_td:first-child]:border-slate-200 [&_td:first-child]:bg-white/95 [&_td:first-child]:shadow-[2px_0_4px_rgba(15,23,42,0.06)]">
                {error ? (
                  <TableRow>
                    <TableCell colSpan={6 + QC_RULES.length} className="py-8 text-center text-red-600">{error}</TableCell>
                  </TableRow>
                ) : sortedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6 + QC_RULES.length} className="py-8 text-center text-slate-500">No enumerator data available yet.</TableCell>
                  </TableRow>
                ) : (
                  sortedItems.map((row) => {
                    const issueRate = toNumber(row.total_cases) > 0 ? Math.round((toNumber(row.open_issues) / toNumber(row.total_cases)) * 100) : 0;
                    const tone = ISSUE_RATE_TONE(issueRate);
                    const qualityScore = Math.max(0, 100 - issueRate);
                    return (
                      <TableRow key={row.enumerator_id} className="h-14 border-b border-white/60 bg-white/10">
                        <TableCell className="font-medium text-slate-800">{row.enumerator_name || row.enumerator_id}</TableCell>
                        <TableCell className="text-right text-slate-700">{row.total_cases.toLocaleString("en-US")}</TableCell>
                        <TableCell className="text-right text-emerald-700">{row.approved_count.toLocaleString("en-US")}</TableCell>
                        <TableCell className="text-right text-slate-700">{toNumber(row.avg_duration_minutes) > 0 ? toNumber(row.avg_duration_minutes).toFixed(1) : "—"}</TableCell>
                        <TableCell className="text-right"><span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${tone.cls}`}>{row.open_issues}</span></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Award className={`h-4 w-4 ${qualityScore >= 90 ? "text-emerald-500" : qualityScore >= 70 ? "text-amber-500" : "text-rose-500"}`} />
                            <span className="font-semibold text-slate-800">{qualityScore}%</span>
                          </div>
                        </TableCell>
                        {QC_RULES.map((rule) => {
                          const count = Number(row[rule.code.toLowerCase()] ?? 0);
                          return (
                            <TableCell key={rule.code} className={`text-right tabular-nums ${count > 0 ? "font-semibold text-rose-700" : "text-slate-500"}`}>
                              {count > 0 ? (
                                <Link
                                  to={explorerQcRuleUrl(row.enumerator_id, rule.code, groupMode)}
                                  className="inline-flex rounded-lg px-2 py-1 text-rose-700 underline decoration-rose-300 underline-offset-4 transition hover:bg-rose-50 hover:text-rose-800"
                                  title={`View ${rule.label} cases for ${row.enumerator_name || row.enumerator_id}`}
                                >
                                  {count}
                                </Link>
                              ) : "—"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
              </Table>
              </div>
            </div>
          </CardContent>
        </ExpandableSection>

        <ExpandableSection
          title={`${groupLabel} productivity by date`}
          storageKey="enumerator-productivity-by-date-v2"
          defaultExpanded={false}
          className="glass-panel rounded-[1.8rem] border-white/70"
          headerClassName="px-5 py-4"
          contentClassName="p-0"
        >
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-white/60 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Daily productivity matrix</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">{groupLabel} productivity by date</h3>
                <p className="mt-1 text-xs text-slate-500">Each cell shows the number of completed interviews for that {groupMode === "city" ? "city" : "enumerator"} on that date.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                  {productivityByDate.items.length} {groupLabelPlural.toLowerCase()} x {productivityByDate.dates.length} dates
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportProductivityByDate}>
                  <Download className="h-4 w-4" /> Export
                </Button>
              </div>
            </div>
            <div className="min-w-0 overflow-x-scroll pb-3">
              <div className="max-h-[500px] overflow-y-auto">
              <ScrollableTable className="w-max min-w-full">
                <ScrollableTableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm">
                  <ScrollableTableRow className="h-12 border-white/60 hover:bg-transparent">
                    <ScrollableTableHead className="sticky left-0 top-0 z-30 min-w-[220px] cursor-pointer border-r border-black bg-white/95 font-semibold text-slate-800 shadow-[2px_0_4px_rgba(0,0,0,0.06)] backdrop-blur-sm" onClick={() => handleMatrixSort("enumerator_id")}>
                      {groupLabel} {matrixSortKey === "enumerator_id" ? (matrixSortDir === "asc" ? "^" : "v") : ""}
                    </ScrollableTableHead>
                    <ScrollableTableHead className="sticky top-0 z-20 min-w-[120px] cursor-pointer whitespace-nowrap border-r border-black bg-white/95 text-center font-semibold text-slate-800 backdrop-blur-sm" onClick={() => handleMatrixSort("total")}>
                      Total {matrixSortKey === "total" ? (matrixSortDir === "asc" ? "^" : "v") : ""}
                    </ScrollableTableHead>
                    {productivityByDate.dates.map((date) => (
                      <ScrollableTableHead key={date} className="sticky top-0 z-20 min-w-[110px] cursor-pointer whitespace-nowrap border-r border-black bg-white/95 text-center font-semibold text-slate-800 backdrop-blur-sm last:border-r-0" onClick={() => handleMatrixSort(date)}>
                        {date} {matrixSortKey === date ? (matrixSortDir === "asc" ? "^" : "v") : ""}
                      </ScrollableTableHead>
                    ))}
                  </ScrollableTableRow>
                </ScrollableTableHeader>
                <ScrollableTableBody>
                  {sortedProductivityRows.map((row) => {
                    const rowTotal = productivityByDate.dates.reduce((sum, date) => sum + Number(row.counts?.[date] ?? 0), 0);
                    return (
                      <ScrollableTableRow key={row.enumerator_id} className="h-14 border-black border-b">
                        <ScrollableTableCell className="sticky left-0 z-10 min-w-[220px] border-r border-black bg-white/95 py-3 align-top text-sm text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] backdrop-blur-sm">
                          <div className="font-semibold">{enumeratorNameById.get(row.enumerator_id) ?? row.enumerator_id}</div>
                          <div className="mt-0.5 font-mono text-xs text-slate-500">{row.enumerator_id}</div>
                        </ScrollableTableCell>
                        <ScrollableTableCell className="border-r border-black text-center text-sm font-semibold text-slate-900">
                          {rowTotal.toLocaleString("en-US")}
                        </ScrollableTableCell>
                        {productivityByDate.dates.map((date) => (
                          <ScrollableTableCell key={`${row.enumerator_id}-${date}`} className="border-r border-black text-center text-sm text-slate-700 last:border-r-0">
                            {row.counts?.[date] ?? 0}
                          </ScrollableTableCell>
                        ))}
                      </ScrollableTableRow>
                    );
                  })}
                </ScrollableTableBody>
              </ScrollableTable>
              </div>
            </div>
          </CardContent>
        </ExpandableSection>
      </div>
    </PlatformPage>
  );

}
