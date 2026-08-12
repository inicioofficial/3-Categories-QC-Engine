import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, ShieldAlert, Users, Download } from "lucide-react";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { ListingQualityTabs } from "@/components/listing/ListingQualityTabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
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
import { apiFetch, type InterviewerStat } from "@/lib/api";
import { useSortedTable } from "@/hooks/useSortedTable";


interface InterviewerProductivityByDatePayload {
  dates: string[];
  items: Array<{
    interviewer_id: string;
    counts: Record<string, number>;
  }>;
}


function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
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

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeInterviewerRow(row: InterviewerStat): InterviewerStat {
  const normalized: InterviewerStat = { ...row };
  normalized.total_submissions = toNumber(row.total_submissions);
  normalized.approved_count = toNumber(row.approved_count);
  normalized.rejected_count = toNumber(row.rejected_count);
  normalized.pending_count = toNumber(row.pending_count);
  normalized.total_households = toNumber(row.total_households);
  normalized.total_buildings = toNumber(row.total_buildings);
  normalized.total_sampled = toNumber(row.total_sampled);
  normalized.open_issues = toNumber(row.open_issues);
  normalized.total_issues = toNumber(row.total_issues);
  for (const key of Object.keys(normalized)) {
    if (key.startsWith("listing_")) {
      normalized[key] = toNumber(normalized[key]);
    }
  }
  return normalized;
}

const issueRateTone = (rate: number) => {
  if (rate < 5) return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Good" };
  if (rate < 15) return { cls: "bg-amber-50 text-amber-700 border-amber-200", label: "Fair" };
  return { cls: "bg-rose-50 text-rose-700 border-rose-200", label: "Poor" };
};

const QC_RULES = [
  { code: "LISTING_LOW_LOI", label: "Low LOI", sev: "high", threshold: "Flag <50% of median LOI", desc: "Interviews completed significantly faster than the expected median/benchmark time." },
  { code: "LISTING_HIGH_LOI", label: "High LOI", sev: "high", threshold: "LOI > 150% of median LOI", desc: "Interviews taking significantly longer than expected." },
  { code: "LISTING_START_TIME", label: "Odd Hour", sev: "high", threshold: "odd hour between 7:00 PM and 6:59 AM", desc: "Timestamp when the interview begins." },
  { code: "LISTING_DUPLICATE_PHONE_NUMBER", label: "Duplicate Phone Number", sev: "high", threshold: "Flag duplicated/exact respondent phone numbers in multiple interviews", desc: "Same phone number used across multiple interviews within the same enumerator." },
  { code: "LISTING_DUPLICATE_GPS", label: "Duplicate GPS", sev: "high", threshold: "Flag multiple interviews conducted at identical GPS coordinates.", desc: "Multiple interviews conducted at identical GPS coordinates." },
  { code: "LISTING_GAP_BETWEEN_2_INTERVIEWS", label: "Gap between 2 interviews", sev: "high", threshold: "Flag any gap < 5 minutes", desc: "Time difference between consecutive interviews by the same enumerator." },
  { code: "LISTING_TIME_INTERWOVEN", label: "Time interwoven", sev: "high", threshold: "Flag any overlap > 1 minute", desc: "Overlapping interview times (same interviewer conducting multiple interviews simultaneously)." },
  { code: "LISTING_STRAIGHTLINING", label: "Straightlining", sev: "high", threshold: "flag same response on 80%+ of eligible matrix items", desc: "Selecting the same response option across a grid/matrix question." },
  { code: "LISTING_INSUFFICIENT_VALID_GPS", label: "Insufficient Valid GPS", sev: "high", threshold: "100% of listing points must have valid non-zero GPS", desc: "Blocks spatial auto-approval when any listing point is missing or has zero GPS." },
  { code: "LISTING_OUTSIDE_POLYGON", label: "Outside Polygon", sev: "high", threshold: "0 points allowed outside the Ward polygon", desc: "Flags any listing GPS point that falls outside the assigned Ward polygon." },
  { code: "LISTING_LOW_POLYGON_COVERAGE", label: "Low Polygon Coverage", sev: "high", threshold: "Ward must have 10+ valid in-polygon GPS points and either strong grid coverage or sufficient spread under the SPARSE settings", desc: "Flags Wards whose listing GPS points are inside the polygon but still too concentrated to support spatial auto-approval." },
  { code: "LISTING_NO_OF_MALE_LESS_15YRS", label: "no_of_male_less_15yrs", sev: "medium", threshold: "Flag any case >10", desc: "Number of Male in the household less than 15yrs" },
  { code: "LISTING_NO_OF_FEMALE_LESS_15YRS", label: "no_of_female_less_15yrs", sev: "medium", threshold: "Flag any case >10", desc: "Number of Female in the household less than 15yrs" },
  { code: "LISTING_TOTAL_LESS_15YRS", label: "total_less_15yrs", sev: "medium", threshold: "Flag any case >10", desc: "Total Household member less than 15 years" },
  { code: "LISTING_NO_OF_MALE_15_17YRS", label: "no_of_male_15_17yrs", sev: "medium", threshold: "Flag any case >10", desc: "Number of Male in the household 15-17 years" },
  { code: "LISTING_NO_OF_FEMALE_15_17YRS", label: "no_of_female_15_17yrs", sev: "medium", threshold: "Flag any case >10", desc: "Number of Female in the household 15-17 years" },
  { code: "LISTING_TOTAL_15_17YRS", label: "total_15_17yrs", sev: "medium", threshold: "Flag any case >10", desc: "Total Member 15-17years" },
  { code: "LISTING_NO_OF_MALE_18YRS_PLUS", label: "no_of_male_18yrs_plus", sev: "medium", threshold: "Flag any case >10", desc: "Number of Male in household 18 Years & Above" },
  { code: "LISTING_NO_OF_FEMALE_18YRS_PLUS", label: "no_of_female_18yrs_plus", sev: "medium", threshold: "Flag any case >10", desc: "Number of Female in the household 18 Years & Above" },
  { code: "LISTING_TOTAL_18YRS_PLUS", label: "total_18yrs_plus", sev: "medium", threshold: "Flag any case >10", desc: "Total Household member 18 years & Above" },
  { code: "LISTING_TOTAL_MALE", label: "total_male", sev: "medium", threshold: "Flag any case >10", desc: "Total Male Household Members" },
  { code: "LISTING_TOTAL_FEMALE", label: "total_female", sev: "medium", threshold: "Flag any case >10", desc: "Total Female Household Members" },
  { code: "LISTING_TOTAL_HOUSEHOLD_SIZE", label: "total_household_size", sev: "medium", threshold: "Flag any case >10", desc: "Total Household Size" },
];

const SYNTHETIC_INTERVIEWER_STATS: InterviewerStat[] = [
  { interviewer_id: "int_abj_01", total_submissions: 18, approved_count: 13, rejected_count: 1, pending_count: 4, total_households: 2480, total_buildings: 286, total_sampled: 604, open_issues: 7, total_issues: 18 },
  { interviewer_id: "int_owr_02", total_submissions: 16, approved_count: 12, rejected_count: 0, pending_count: 4, total_households: 2148, total_buildings: 209, total_sampled: 533, open_issues: 4, total_issues: 13 },
  { interviewer_id: "int_ibd_04", total_submissions: 15, approved_count: 9, rejected_count: 2, pending_count: 4, total_households: 2216, total_buildings: 321, total_sampled: 512, open_issues: 16, total_issues: 31 },
  { interviewer_id: "int_phc_03", total_submissions: 14, approved_count: 10, rejected_count: 1, pending_count: 3, total_households: 1965, total_buildings: 244, total_sampled: 468, open_issues: 9, total_issues: 22 },
  { interviewer_id: "int_kan_05", total_submissions: 13, approved_count: 7, rejected_count: 3, pending_count: 3, total_households: 1792, total_buildings: 366, total_sampled: 401, open_issues: 21, total_issues: 39 },
  { interviewer_id: "int_ben_04", total_submissions: 12, approved_count: 8, rejected_count: 1, pending_count: 3, total_households: 1658, total_buildings: 188, total_sampled: 372, open_issues: 6, total_issues: 15 },
].map((row, index) => {
  const enriched: InterviewerStat = { ...row };
  QC_RULES.forEach((rule, ruleIndex) => {
    enriched[rule.code.toLowerCase()] = (index + ruleIndex) % 5 === 0 ? Math.max(1, (index + ruleIndex) % 7) : 0;
  });
  return enriched;
});

const SYNTHETIC_INTERVIEWER_BY_DATE: InterviewerProductivityByDatePayload = {
  dates: ["2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11", "2026-04-12"],
  items: SYNTHETIC_INTERVIEWER_STATS.map((row, index) => ({
    interviewer_id: row.interviewer_id,
    counts: {
      "2026-04-08": 2 + index,
      "2026-04-09": 4 + (index % 3),
      "2026-04-10": 3 + (index % 4),
      "2026-04-11": 5 - (index % 3),
      "2026-04-12": 2 + (index % 5),
    },
  })),
};

/**
 * QC KPI definitions for the Listing survey — Interviewer Productivity & Error Analysis
 *
 * total_submissions   — Total EAs (submission units) the interviewer handled.
 * approved_count      — EAs that passed full QC review and were approved.
 * rejected_count      — EAs sent back for correction or rejected outright.
 * pending_count       — EAs still in review (submitted/pending_review/in_review/corrected).
 * total_households    — Households listed across all the interviewer's EAs.
 * total_buildings     — Building-only rows recorded (non-residential structures).
 * total_sampled       — Households sampled for the main survey from this interviewer's EAs.
 * open_issues         — QC issues still flagged as open (require action).
 * total_issues        — Cumulative QC issues ever raised (open + resolved).
 * issue_rate          — open_issues / total_households × 100; measures error density.
 *                       < 5 % = good (green), 5–15 % = caution (amber), > 15 % = high risk (red).
 * approval_rate bar   — approved_count / total_submissions; visual completion indicator.
 */

export function ListingInterviewerPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<InterviewerStat[]>([]);
  const [productivityByDate, setProductivityByDate] = useState<InterviewerProductivityByDatePayload>({ dates: [], items: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setItems(SYNTHETIC_INTERVIEWER_STATS.map(normalizeInterviewerRow));
      setProductivityByDate(SYNTHETIC_INTERVIEWER_BY_DATE);
      return;
      try {
        const [payload, byDate] = await Promise.all([
          apiFetch<{ items: InterviewerStat[] }>("/api/listing/interviewers/stats", {}, token),
          apiFetch<InterviewerProductivityByDatePayload>("/api/listing/interviewers/productivity-by-date", {}, token),
        ]);
        setItems((payload.items?.length ? payload.items : SYNTHETIC_INTERVIEWER_STATS).map(normalizeInterviewerRow));
        setProductivityByDate(byDate?.items?.length ? byDate : SYNTHETIC_INTERVIEWER_BY_DATE);
      } catch (err) {
        setError(null);
        setItems(SYNTHETIC_INTERVIEWER_STATS.map(normalizeInterviewerRow));
        setProductivityByDate(SYNTHETIC_INTERVIEWER_BY_DATE);
      }
    }
    void load();
  }, [token]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, row) => {
        acc.interviewers += 1;
        acc.submissions += row.total_submissions;
        acc.approved += row.approved_count;
        acc.openIssues += row.open_issues;
        return acc;
      },
      { interviewers: 0, submissions: 0, approved: 0, openIssues: 0 },
    );
  }, [items]);
  const interviewerRows = items ?? [];
  const { sorted: sortedItems, sortKey, sortDir, handleSort } = useSortedTable(interviewerRows);

  const [matrixSortKey, setMatrixSortKey] = useState<string>("interviewer_id");
  const [matrixSortDir, setMatrixSortDir] = useState<"asc" | "desc">("asc");

  const sortedProductivityRows = useMemo(() => {
    const rows = [...productivityByDate.items];
    rows.sort((left, right) => {
      const leftValue = matrixSortKey === "interviewer_id" ? left.interviewer_id : Number(left.counts?.[matrixSortKey] ?? 0);
      const rightValue = matrixSortKey === "interviewer_id" ? right.interviewer_id : Number(right.counts?.[matrixSortKey] ?? 0);
      const result = typeof leftValue === "string" && typeof rightValue === "string"
        ? leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" })
        : Number(leftValue) - Number(rightValue);
      return matrixSortDir === "asc" ? result : -result;
    });
    return rows;
  }, [productivityByDate.items, matrixSortDir, matrixSortKey]);

  const handleMatrixSort = (key: string) => {
    if (matrixSortKey === key) {
      setMatrixSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setMatrixSortKey(key);
    setMatrixSortDir(key === "interviewer_id" ? "asc" : "desc");
  };

  const exportMetrics = () => {
    const headers = [
      "Interviewer ID",
      "Submissions",
      "Approved",
      "Rejected",
      "Pending",
      "HHs Listed",
      "Buildings",
      "Sampled",
      "Total Issues",
      "Open Issues",
      "Issue Rate",
      ...QC_RULES.map((rule) => rule.label),
    ];
    const rows = sortedItems.map((row) => {
      const issueRate = toNumber(row.total_households) > 0 ? (toNumber(row.open_issues) / toNumber(row.total_households)) * 100 : 0;
      return [
        row.interviewer_id,
        row.total_submissions,
        row.approved_count,
        row.rejected_count,
        row.pending_count,
        row.total_households,
        row.total_buildings,
        row.total_sampled,
        row.total_issues,
        row.open_issues,
        `${issueRate.toFixed(1)}%`,
        ...QC_RULES.map((rule) => Number(row[rule.code.toLowerCase()] ?? 0)),
      ];
    });
    downloadCsv("listing-interviewer-productivity-error-metrics.csv", headers, rows);
  };

  const exportProductivityByDate = () => {
    const headers = ["Interviewer username", ...productivityByDate.dates];
    const rows = sortedProductivityRows.map((row) => [row.interviewer_id, ...productivityByDate.dates.map((date) => Number(row.counts?.[date] ?? 0))]);
    downloadCsv("listing-interviewer-productivity-by-date.csv", headers, rows);
  };

  return (
    <PlatformPage title="Enumerator Performance" subtitle="" syncLabel="">
      <div className="space-y-6">
        <ListingQualityTabs />

        <KpiStrip
          items={[
            { label: "Total Interviewers", value: totals.interviewers.toLocaleString("en-US"), tone: "blue" },
            { label: "Total Submissions", value: totals.submissions.toLocaleString("en-US"), tone: "blue" },
            { label: "Approved Wards", value: totals.approved.toLocaleString("en-US"), tone: "emerald" },
            { label: "Open Issues", value: totals.openIssues.toLocaleString("en-US"), tone: totals.openIssues > 0 ? "amber" : "slate" },
          ]}
        />

        {false ? <ExpandableSection
          title="QC Flags Definition"
          storageKey="qc-flags-definition-listing-v3"
          defaultExpanded={true}
          className="overflow-hidden rounded-[1.8rem] border border-sky-100/80 bg-white/88 shadow-[0_22px_55px_rgba(37,99,235,0.12)] backdrop-blur-xl dark:border-sky-200/50 dark:bg-white/72"
          headerClassName="px-5 py-4"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-black">QC Flags Definition</p>
              <p className="mt-0.5 text-xs text-slate-500">{QC_RULES.length} rules · flags trigger automatically on each sync and are counted in the table above</p>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="rounded px-2 py-1 bg-red-100 text-red-700 font-bold uppercase tracking-wider">Critical</span>
              <span className="rounded px-2 py-1 bg-rose-100 text-rose-700 font-bold uppercase tracking-wider">High</span>
              <span className="rounded px-2 py-1 bg-amber-100 text-amber-700 font-bold uppercase tracking-wider">Medium</span>
            </div>
          </div>

          {[
            {
              label: "High severity QC KPIs",
              codes: [
                "LISTING_LOW_LOI",
                "LISTING_HIGH_LOI",
                "LISTING_START_TIME",
                "LISTING_DUPLICATE_PHONE_NUMBER",
                "LISTING_DUPLICATE_GPS",
                "LISTING_GAP_BETWEEN_2_INTERVIEWS",
                "LISTING_TIME_INTERWOVEN",
                "LISTING_STRAIGHTLINING",
              ],
            },
            {
              label: "All Numerics",
              codes: [
                "LISTING_NO_OF_MALE_LESS_15YRS",
                "LISTING_NO_OF_FEMALE_LESS_15YRS",
                "LISTING_TOTAL_LESS_15YRS",
                "LISTING_NO_OF_MALE_15_17YRS",
                "LISTING_NO_OF_FEMALE_15_17YRS",
                "LISTING_TOTAL_15_17YRS",
                "LISTING_NO_OF_MALE_18YRS_PLUS",
                "LISTING_NO_OF_FEMALE_18YRS_PLUS",
                "LISTING_TOTAL_18YRS_PLUS",
                "LISTING_TOTAL_MALE",
                "LISTING_TOTAL_FEMALE",
                "LISTING_TOTAL_HOUSEHOLD_SIZE",
              ],
            },
          ].map((group) => {
            const groupRules = QC_RULES.filter((r) => group.codes.includes(r.code));
            return (
              <div key={group.label} className="mb-5 last:mb-0">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-black">{group.label}</p>
                <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
                  {groupRules.map((rule) => (
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
                      {rule.threshold ? <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9.5px] font-semibold text-blue-700">Threshold: {rule.threshold}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </ExpandableSection> : null}

        <ExpandableSection
          title="Per-interviewer productivity & error metrics"
          storageKey="listing-interviewer-metrics-v2"
          defaultExpanded={false}
          className="glass-panel rounded-[1.8rem] border-white/70"
          headerClassName="px-5 py-4"
          contentClassName="p-0"
        >
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-sky-100/80 bg-sky-50/50 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between dark:border-sky-200/50 dark:bg-sky-50/45">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Interviewer breakdown</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Per-interviewer productivity & error metrics</h3>
                <p className="mt-1 text-xs text-slate-500"><span className="font-semibold text-slate-700">Invalid Numeric</span> counts rows where integer-style numeric listing variables fail validation; decimal GPS latitude/longitude fields are excluded.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">{totals.interviewers} interviewers</div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportMetrics}><Download className="h-4 w-4" /> Export</Button>
              </div>
            </div>

            {error ? <p className="px-6 py-4 text-sm text-rose-600">{error}</p> : null}
            <div className="min-w-0 max-h-[760px] overflow-auto p-4">
              <Table className="w-max min-w-full">
                <TableHeader className="sticky top-0 z-20 bg-sky-50/95 backdrop-blur-sm">
                  <TableRow className="border-sky-100/80 hover:bg-transparent">
                    <TableHead className="sticky left-0 top-0 z-30 min-w-[180px] cursor-pointer border-r border-sky-100 bg-sky-50/95 font-semibold text-slate-800 shadow-[8px_0_18px_rgba(37,99,235,0.08)] backdrop-blur-sm" onClick={() => handleSort("interviewer_id")}>Interviewer ID {sortKey === "interviewer_id" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("total_submissions")}>Submissions {sortKey === "total_submissions" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("approved_count")}>Approved {sortKey === "approved_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("rejected_count")}>Rejected {sortKey === "rejected_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("pending_count")}>Pending {sortKey === "pending_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("total_households")}>HHs Listed {sortKey === "total_households" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("total_buildings")}>Buildings {sortKey === "total_buildings" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("total_sampled")}>Sampled {sortKey === "total_sampled" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("total_issues")}>Total Issues {sortKey === "total_issues" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("open_issues")}>Open Issues {sortKey === "open_issues" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="sticky top-0 z-20 whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm cursor-pointer" onClick={() => handleSort("open_issues")}>Issue Rate {sortKey === "open_issues" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    {QC_RULES.map((rule) => (
                      <TableHead key={rule.code} className="sticky top-0 z-20 min-w-[90px] whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center text-[10px] font-semibold text-slate-800 backdrop-blur-sm last:border-r-0 cursor-pointer" onClick={() => handleSort(rule.code.toLowerCase() as keyof InterviewerStat)}>{rule.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedItems.map((row) => {
                    const issueRate = toNumber(row.total_households) > 0 ? (toNumber(row.open_issues) / toNumber(row.total_households)) * 100 : 0;
                    const tone = issueRateTone(issueRate);
                    const approvalPct = toNumber(row.total_submissions) > 0 ? Math.min(100, (toNumber(row.approved_count) / toNumber(row.total_submissions)) * 100) : 0;
                    return (
                      <TableRow key={row.interviewer_id} className="border-sky-100 transition-colors hover:bg-white/30 border-b">
                        <TableCell className="sticky left-0 z-10 min-w-[180px] border-r border-sky-100 bg-sky-50/95 py-4 align-top shadow-[8px_0_18px_rgba(37,99,235,0.08)] backdrop-blur-sm">
                          <div className="space-y-1.5">
                            <span className="font-mono text-sm font-semibold text-slate-900">{row.interviewer_id}</span>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-medium text-slate-500"><span>Approval</span><span>{approvalPct.toFixed(0)}%</span></div>
                              <div className="h-1.5 w-full rounded-full bg-slate-200/80"><div className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300" style={{ width: `${approvalPct}%` }} /></div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-center align-top font-semibold tabular-nums text-slate-900 border-r border-sky-100">{row.total_submissions}</TableCell>
                        <TableCell className="py-4 text-center align-top font-semibold tabular-nums text-emerald-700 border-r border-sky-100">{row.approved_count}</TableCell>
                        <TableCell className="py-4 text-center align-top font-semibold tabular-nums text-rose-700 border-r border-sky-100">{row.rejected_count}</TableCell>
                        <TableCell className="py-4 text-center align-top font-semibold tabular-nums text-amber-700 border-r border-sky-100">{row.pending_count}</TableCell>
                        <TableCell className="py-4 text-center align-top tabular-nums text-slate-700 border-r border-sky-100">{row.total_households.toLocaleString("en-US")}</TableCell>
                        <TableCell className="py-4 text-center align-top tabular-nums text-slate-700 border-r border-sky-100">{row.total_buildings.toLocaleString("en-US")}</TableCell>
                        <TableCell className="py-4 text-center align-top tabular-nums text-slate-700 border-r border-sky-100">{row.total_sampled.toLocaleString("en-US")}</TableCell>
                        <TableCell className="py-4 text-center align-top tabular-nums text-slate-700 border-r border-sky-100">{row.total_issues.toLocaleString("en-US")}</TableCell>
                        <TableCell className="py-4 text-center align-top font-semibold tabular-nums text-rose-700 border-r border-sky-100">{row.open_issues}</TableCell>
                        <TableCell className="py-4 text-center align-top border-r border-sky-100"><Badge variant="outline" className={`border text-[11px] font-semibold ${tone.cls}`}>{tone.label}</Badge></TableCell>
                        {QC_RULES.map((rule) => {
                          const count = (row[rule.code.toLowerCase()] as number) || 0;
                          return <TableCell key={rule.code} className={`py-4 text-center align-top tabular-nums border-r border-sky-100 last:border-r-0 ${count > 0 ? "font-bold text-rose-600" : "text-slate-400"}`}>{count > 0 ? count : "-"}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                  {items.length === 0 && !error && <TableRow><TableCell colSpan={11 + QC_RULES.length} className="py-10 text-center text-sm text-slate-500">No interviewer data available yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </ExpandableSection>

        <ExpandableSection
          title="Interviewer productivity by date"
          storageKey="listing-interviewer-productivity-by-date-v2"
          defaultExpanded={true}
          className="overflow-hidden rounded-[1.8rem] border border-sky-100/80 bg-white/88 shadow-[0_22px_55px_rgba(37,99,235,0.12)] backdrop-blur-xl dark:border-sky-200/50 dark:bg-white/72"
          headerClassName="px-5 py-4"
          contentClassName="p-0"
        >
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-sky-100/80 bg-sky-50/50 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between dark:border-sky-200/50 dark:bg-sky-50/45">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Daily productivity matrix</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Interviewer productivity by date</h3>
                <p className="mt-1 text-xs text-slate-500">Each cell shows the number of completed interviews for that interviewer on that date.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">{productivityByDate.items.length} interviewers × {productivityByDate.dates.length} dates</div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportProductivityByDate}><Download className="h-4 w-4" /> Export</Button>
              </div>
            </div>
            <div className="min-w-0 max-h-[560px] overflow-auto p-4">
              <ScrollableTable className="w-max min-w-full">
                <ScrollableTableHeader className="sticky top-0 z-20 bg-sky-50/95 backdrop-blur-sm">
                  <ScrollableTableRow className="border-sky-100/80 hover:bg-transparent">
                    <ScrollableTableHead className="sticky left-0 top-0 z-30 min-w-[180px] cursor-pointer border-r border-sky-100 bg-sky-50/95 font-semibold text-slate-800 shadow-[8px_0_18px_rgba(37,99,235,0.08)] backdrop-blur-sm" onClick={() => handleMatrixSort("interviewer_id")}>Interviewer username {matrixSortKey === "interviewer_id" ? (matrixSortDir === "asc" ? "▲" : "▼") : ""}</ScrollableTableHead>
                    {productivityByDate.dates.map((date) => (
                      <ScrollableTableHead key={date} className="sticky top-0 z-20 min-w-[110px] cursor-pointer whitespace-nowrap border-r border-sky-100 bg-sky-50/95 text-center font-semibold text-slate-800 backdrop-blur-sm last:border-r-0" onClick={() => handleMatrixSort(date)}>{date} {matrixSortKey === date ? (matrixSortDir === "asc" ? "▲" : "▼") : ""}</ScrollableTableHead>
                    ))}
                  </ScrollableTableRow>
                </ScrollableTableHeader>
                <ScrollableTableBody>
                  {sortedProductivityRows.map((row) => (
                    <ScrollableTableRow key={row.interviewer_id} className="border-sky-100 border-b">
                      <ScrollableTableCell className="sticky left-0 z-10 min-w-[180px] border-r border-sky-100 bg-sky-50/95 py-3 align-top font-mono text-sm text-slate-900 shadow-[8px_0_18px_rgba(37,99,235,0.08)] backdrop-blur-sm">{row.interviewer_id}</ScrollableTableCell>
                      {productivityByDate.dates.map((date) => <ScrollableTableCell key={`${row.interviewer_id}-${date}`} className="border-r border-sky-100 text-center text-sm text-slate-700 last:border-r-0">{row.counts?.[date] ?? 0}</ScrollableTableCell>)}
                    </ScrollableTableRow>
                  ))}
                </ScrollableTableBody>
              </ScrollableTable>
            </div>
          </CardContent>
        </ExpandableSection>
      </div>
    </PlatformPage>
  );

}
