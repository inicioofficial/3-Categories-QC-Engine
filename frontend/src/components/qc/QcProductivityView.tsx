import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
  ScrollableTable,
  ScrollableTableBody,
  ScrollableTableCell,
  ScrollableTableHead,
  ScrollableTableHeader,
  ScrollableTableRow,
} from "@/components/ui/ScrollableTable";
import { TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { useSortedTable } from "@/hooks/useSortedTable";
import { apiFetch, type QcProductivityByDatePayload, type QcProductivityItem, type QcProductivityTotals } from "@/lib/api";

type QueueFilter = "all" | "audio" | "callback";
type GroupByFilter = "interviewer" | "city" | "qc_user";
type ViewMode = "cases" | "date";

const QUEUE_OPTIONS: Array<{ value: QueueFilter; label: string }> = [
  { value: "all", label: "All queues" },
  { value: "callback", label: "Callback" },
  { value: "audio", label: "Silent listening" },
];
const GROUP_OPTIONS: Array<{ value: GroupByFilter; label: string; noun: string; column: string }> = [
  { value: "interviewer", label: "By Interviewer", noun: "interviewers", column: "Interviewer" },
  { value: "city", label: "By City", noun: "cities", column: "City" },
  { value: "qc_user", label: "By In-Office QC", noun: "QC users", column: "QC username" },
];

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

export function QcProductivityView({
  module,
  title,
  summaryEndpoint,
  byDateEndpoint,
  storageKeyPrefix,
  exportPrefix,
  queueMessage,
}: {
  module: "main" | "listing";
  title: string;
  summaryEndpoint: string;
  byDateEndpoint: string;
  storageKeyPrefix: string;
  exportPrefix: string;
  queueMessage?: (queue: QueueFilter) => string | null;
}) {
  const { token } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("cases");
  const [queue, setQueue] = useState<QueueFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupByFilter>("qc_user");
  const [items, setItems] = useState<QcProductivityItem[]>([]);
  const [serverTotals, setServerTotals] = useState<QcProductivityTotals | null>(null);
  const [productivityByDate, setProductivityByDate] = useState<QcProductivityByDatePayload>({ dates: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const effectiveGroupBy = module === "main" ? groupBy : "qc_user";
        const query = `?queue=${encodeURIComponent(queue)}&group_by=${encodeURIComponent(effectiveGroupBy)}`;
        const [summaryPayload, byDatePayload] = await Promise.all([
          apiFetch<{ items: QcProductivityItem[]; totals?: QcProductivityTotals }>(`${summaryEndpoint}${query}`, {}, token),
          apiFetch<QcProductivityByDatePayload>(`${byDateEndpoint}${query}`, {}, token),
        ]);
        if (cancelled) return;
        setItems(summaryPayload.items ?? []);
        setServerTotals(summaryPayload.totals ?? null);
        setProductivityByDate(byDatePayload ?? { dates: [], items: [] });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load QC productivity.");
        setItems([]);
        setServerTotals(null);
        setProductivityByDate({ dates: [], items: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [byDateEndpoint, groupBy, module, queue, summaryEndpoint, token]);

  const activeGroup = GROUP_OPTIONS.find((option) => option.value === groupBy) ?? GROUP_OPTIONS[2];
  const subjectColumn = module === "main" ? activeGroup.column : "QC username";
  const subjectNoun = module === "main" ? activeGroup.noun : "QC users";

  const totals = useMemo(() => {
    const rowTotals = items.reduce(
        (acc, row) => {
          acc.users += 1;
          acc.totalPushed += Number(row.total_pushed ?? 0);
          acc.approved += Number(row.approved ?? row.completed ?? 0);
          acc.pending += Number(row.pending ?? 0);
          acc.canceled += Number(row.canceled ?? 0);
          return acc;
        },
        { users: 0, totalPushed: 0, approved: 0, pending: 0, canceled: 0 },
      );
    if (!serverTotals) return rowTotals;
    return {
      ...rowTotals,
      approved: Number(serverTotals.approved ?? rowTotals.approved),
      pending: Number(serverTotals.pending ?? rowTotals.pending),
      canceled: Number(serverTotals.canceled ?? rowTotals.canceled),
    };
  }, [items, serverTotals]);

  const { sorted: sortedItems, sortKey, sortDir, handleSort } = useSortedTable(items);
  const [matrixSortKey, setMatrixSortKey] = useState<string>("username");
  const [matrixSortDir, setMatrixSortDir] = useState<"asc" | "desc">("asc");

  const sortedProductivityRows = useMemo(() => {
    const rows = [...productivityByDate.items];
    rows.sort((left, right) => {
      const leftTotal = productivityByDate.dates.reduce((sum, date) => sum + Number(left.counts?.[date] ?? 0), 0);
      const rightTotal = productivityByDate.dates.reduce((sum, date) => sum + Number(right.counts?.[date] ?? 0), 0);
      const leftValue = matrixSortKey === "username" ? left.username : matrixSortKey === "total" ? leftTotal : Number(left.counts?.[matrixSortKey] ?? 0);
      const rightValue = matrixSortKey === "username" ? right.username : matrixSortKey === "total" ? rightTotal : Number(right.counts?.[matrixSortKey] ?? 0);
      const result =
        typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" })
          : Number(leftValue) - Number(rightValue);
      return matrixSortDir === "asc" ? result : -result;
    });
    return rows;
  }, [matrixSortDir, matrixSortKey, productivityByDate.dates, productivityByDate.items]);

  const handleMatrixSort = (key: string) => {
    if (matrixSortKey === key) {
      setMatrixSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setMatrixSortKey(key);
    setMatrixSortDir(key === "username" ? "asc" : "desc");
  };

  const exportCases = () => {
    const headers = [subjectColumn, "Cases pushed", "Approved", "Pending", "Canceled"];
    const rows = sortedItems.map((row) => [
      row.username,
      Number(row.total_pushed ?? 0),
      Number(row.approved ?? row.completed ?? 0),
      Number(row.pending ?? 0),
      Number(row.canceled ?? 0),
    ]);
    downloadCsv(`${exportPrefix}-qc-productivity-by-cases.csv`, headers, rows);
  };

  const exportByDate = () => {
    const headers = [subjectColumn, "Full name", "Total pushed", ...productivityByDate.dates];
    const rows = sortedProductivityRows.map((row) => [
      row.username,
      row.full_name || "-",
      productivityByDate.dates.reduce((sum, date) => sum + Number(row.counts?.[date] ?? 0), 0),
      ...productivityByDate.dates.map((date) => Number(row.counts?.[date] ?? 0)),
    ]);
    downloadCsv(`${exportPrefix}-qc-productivity-by-date.csv`, headers, rows);
  };

  const currentQueueMessage = queueMessage?.(queue) ?? null;
  const emptyCases = !loading && !error && sortedItems.length === 0;
  const emptyByDate = !loading && !error && sortedProductivityRows.length === 0;

  return (
    <PlatformPage title={title} subtitle="" syncLabel="" module={module}>
      <div className="space-y-6">
        <KpiStrip
          items={[
            { label: module === "main" ? `Active ${subjectNoun}` : "Active QC users", value: totals.users.toLocaleString("en-US"), tone: "blue" },
            { label: "Cases pushed to QC", value: totals.totalPushed.toLocaleString("en-US"), tone: "blue" },
            { label: "Approved", value: totals.approved.toLocaleString("en-US"), tone: "emerald" },
            { label: "Canceled", value: totals.canceled.toLocaleString("en-US"), tone: totals.canceled > 0 ? "amber" : "emerald" },
          ]}
        />

        <div className="flex flex-col gap-3 rounded-[1.4rem] border border-white/70 bg-white/55 p-3 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
          {module === "main" ? (
            <div className="flex flex-wrap items-center gap-2">
              {GROUP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGroupBy(option.value)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    groupBy === option.value ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white/75 text-slate-600 hover:bg-white"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {QUEUE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setQueue(option.value)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  queue === option.value ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 bg-white/75 text-slate-600 hover:bg-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("cases")}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                viewMode === "cases" ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white/75 text-slate-600 hover:bg-white"
              }`}
            >
              Summary table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("date")}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                viewMode === "date" ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white/75 text-slate-600 hover:bg-white"
              }`}
            >
              By assigned date
            </button>
          </div>
          </div>
        </div>

        {viewMode === "cases" ? (
          <ExpandableSection
            title=""
            staticSection
            storageKey={`${storageKeyPrefix}-cases`}
            defaultExpanded
            className="glass-panel rounded-[1.8rem] border-white/70"
            headerClassName="px-5 py-4"
            contentClassName="p-0"
          >
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b border-white/60 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  {currentQueueMessage ? <p className="text-xs text-slate-500">{currentQueueMessage}</p> : null}
                </div>
                <div className="flex flex-col gap-3 lg:items-end">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                      {items.length} {subjectNoun}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportCases}>
                      <Download className="h-4 w-4" /> Export
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-w-0 overflow-x-auto">
                <ScrollableTable maxHeight={850}>
                  <ScrollableTableHeader>
                    <TableRow className="border-b border-white/60 bg-white/20">
                      <TableHead className="cursor-pointer text-slate-600" onClick={() => handleSort("username")}>
                        {subjectColumn} {sortKey === "username" ? (sortDir === "asc" ? "^" : "v") : ""}
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("total_pushed")}>
                        Cases pushed {sortKey === "total_pushed" ? (sortDir === "asc" ? "^" : "v") : ""}
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("approved")}>
                        Approved {sortKey === "approved" ? (sortDir === "asc" ? "^" : "v") : ""}
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("pending")}>
                        Pending {sortKey === "pending" ? (sortDir === "asc" ? "^" : "v") : ""}
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-slate-600" onClick={() => handleSort("canceled")}>
                        Canceled {sortKey === "canceled" ? (sortDir === "asc" ? "^" : "v") : ""}
                      </TableHead>
                    </TableRow>
                  </ScrollableTableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-slate-500">Loading QC productivity...</TableCell>
                      </TableRow>
                    ) : error ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-rose-600">{error}</TableCell>
                      </TableRow>
                    ) : emptyCases ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-slate-500">No QC activity found for this queue.</TableCell>
                      </TableRow>
                    ) : (
                      sortedItems.map((row) => (
                        <TableRow key={row.username} className="border-b border-white/60 bg-white/10">
                          <TableCell className="font-mono text-sm text-slate-800">{row.username}</TableCell>
                          <TableCell className="text-right text-slate-700">{Number(row.total_pushed ?? 0).toLocaleString("en-US")}</TableCell>
                          <TableCell className="text-right text-emerald-700">{Number(row.approved ?? row.completed ?? 0).toLocaleString("en-US")}</TableCell>
                          <TableCell className="text-right text-amber-700">{Number(row.pending ?? 0).toLocaleString("en-US")}</TableCell>
                          <TableCell className="text-right text-rose-700">{Number(row.canceled ?? 0).toLocaleString("en-US")}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </ScrollableTable>
              </div>
            </CardContent>
          </ExpandableSection>
        ) : (
          <ExpandableSection
            title="QC productivity by date"
            staticSection
            storageKey={`${storageKeyPrefix}-date`}
            defaultExpanded
            className="glass-panel rounded-[1.8rem] border-white/70"
            headerClassName="px-5 py-4"
            contentClassName="p-0"
          >
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b border-white/60 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Daily productivity matrix</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-900">QC productivity by assigned date</h3>
                  <p className="mt-1 text-xs text-slate-500">Each cell shows the number of tasks pushed to that QC user on that date.</p>
                  {currentQueueMessage ? <p className="text-xs text-slate-500">{currentQueueMessage}</p> : null}
                </div>
                <div className="flex flex-col gap-3 lg:items-end">
                  <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                    {productivityByDate.items.length} {subjectNoun} x {productivityByDate.dates.length} dates
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportByDate}>
                    <Download className="h-4 w-4" /> Export
                  </Button>
                  </div>
                </div>
              </div>

              {error ? <p className="px-6 py-4 text-sm text-rose-600">{error}</p> : null}
              <div className="min-w-0 max-h-[560px] overflow-auto">
                <ScrollableTable className="w-max min-w-full">
                  <ScrollableTableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm">
                    <ScrollableTableRow className="border-white/60 hover:bg-transparent">
                      <ScrollableTableHead
                        className="sticky left-0 top-0 z-30 min-w-[180px] cursor-pointer border-r border-black bg-white/95 font-semibold text-slate-800 shadow-[2px_0_4px_rgba(0,0,0,0.06)] backdrop-blur-sm"
                        onClick={() => handleMatrixSort("username")}
                      >
                        {subjectColumn} {matrixSortKey === "username" ? (matrixSortDir === "asc" ? "^" : "v") : ""}
                      </ScrollableTableHead>
                      <ScrollableTableHead
                        className="sticky top-0 z-20 min-w-[120px] cursor-pointer whitespace-nowrap border-r border-black bg-white/95 text-center font-semibold text-slate-800 backdrop-blur-sm"
                        onClick={() => handleMatrixSort("total")}
                      >
                        Total {matrixSortKey === "total" ? (matrixSortDir === "asc" ? "^" : "v") : ""}
                      </ScrollableTableHead>
                      {productivityByDate.dates.map((date) => (
                        <ScrollableTableHead
                          key={date}
                          className="sticky top-0 z-20 min-w-[110px] cursor-pointer whitespace-nowrap border-r border-black bg-white/95 text-center font-semibold text-slate-800 backdrop-blur-sm last:border-r-0"
                          onClick={() => handleMatrixSort(date)}
                        >
                          {date} {matrixSortKey === date ? (matrixSortDir === "asc" ? "^" : "v") : ""}
                        </ScrollableTableHead>
                      ))}
                    </ScrollableTableRow>
                  </ScrollableTableHeader>
                  <ScrollableTableBody>
                    {loading ? (
                      <ScrollableTableRow>
                        <ScrollableTableCell colSpan={Math.max(productivityByDate.dates.length + 2, 2)} className="py-8 text-center text-slate-500">
                          Loading QC productivity...
                        </ScrollableTableCell>
                      </ScrollableTableRow>
                    ) : emptyByDate ? (
                      <ScrollableTableRow>
                        <ScrollableTableCell colSpan={Math.max(productivityByDate.dates.length + 2, 2)} className="py-8 text-center text-slate-500">
                          No QC activity found for this queue.
                        </ScrollableTableCell>
                      </ScrollableTableRow>
                    ) : (
                      sortedProductivityRows.map((row) => {
                        const rowTotal = productivityByDate.dates.reduce((sum, date) => sum + Number(row.counts?.[date] ?? 0), 0);
                        return (
                          <ScrollableTableRow key={row.username} className="border-black border-b">
                            <ScrollableTableCell className="sticky left-0 z-10 min-w-[180px] border-r border-black bg-white/95 py-3 align-top text-sm text-slate-900 shadow-[2px_0_4px_rgba(0,0,0,0.06)] backdrop-blur-sm">
                              <div className="font-semibold">{row.full_name || row.username}</div>
                              <div className="mt-0.5 font-mono text-xs text-slate-500">{row.username}</div>
                            </ScrollableTableCell>
                            <ScrollableTableCell className="border-r border-black text-center text-sm font-semibold text-slate-900">
                              {rowTotal.toLocaleString("en-US")}
                            </ScrollableTableCell>
                            {productivityByDate.dates.map((date) => (
                              <ScrollableTableCell key={`${row.username}-${date}`} className="border-r border-black text-center text-sm text-slate-700 last:border-r-0">
                                {row.counts?.[date] ?? 0}
                              </ScrollableTableCell>
                            ))}
                          </ScrollableTableRow>
                        );
                      })
                    )}
                  </ScrollableTableBody>
                </ScrollableTable>
              </div>
            </CardContent>
          </ExpandableSection>
        )}
      </div>
    </PlatformPage>
  );
}
