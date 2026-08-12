import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Filter } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyState, PlatformPage } from "@/app/platform-page";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { useAuth } from "@/app/auth";
import {
  apiFetch,
  type BreakdownState,
  type ListingAnalysisCard,
  type ListingAnalysisFilterOptions,
  type ListingAnalysisPayload,
} from "@/lib/api";

// ─── Colour palette (mirrors MainSurveySectionPage) ───────────────────────────
const BAR_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#06b6d4",
  "#84cc16",
  "#fb923c",
];

// ─── CSV export helper ────────────────────────────────────────────────────────
function downloadCsv(fileName: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const v = String(row[h] ?? "");
          return `"${v.replace(/"/g, '""')}"`;
        })
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Question distribution card ───────────────────────────────────────────────
function formatAnswerLabel(label: string): string {
  if (label === "Unknown/Missing" || label === "Not Provided") return label;
  const n = Number(label);
  if (!Number.isNaN(n) && Number.isFinite(n) && label.trim() !== "") {
    return Math.floor(n) === n ? String(Math.floor(n)) : String(n);
  }
  return label;
}

function formatNumericStat(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n);
}

function QuestionDistributionCard({ card, onAnswerClick, canExportTables }: { card: ListingAnalysisCard; onAnswerClick?: (row: ListingAnalysisCard["tableRows"][number], card: ListingAnalysisCard) => void; canExportTables: boolean; }) {
  const exportRows = card.tableRows.map((row) => ({
    variable: card.variable,
    answer: row.label,
    code: row.code,
    count: row.count,
    percent: row.percent,
  }));
  const hasStats = card.stats != null;

  return (
    <div className="overflow-hidden rounded-[1.2rem] border border-white/70 bg-white/70 shadow-sm">
      {/* Header with 3-column layout when stats exist */}
      <div className={hasStats ? "grid grid-cols-[1fr_minmax(0,320px)_auto] items-center gap-4 border-b border-slate-100 bg-white/60 px-5 py-4" : "flex items-start justify-between gap-4 border-b border-slate-100 bg-white/60 px-5 py-4"}>
        {/* Left: Question label */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-sky-600">{card.variable}</span>
          </div>
          <p className="text-sm font-semibold leading-snug text-slate-800">{card.label}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Base n:{" "}
            <span className="font-semibold text-slate-700">
              {card.responseCount > 0 ? card.responseCount.toLocaleString() : "No data"}
            </span>
          </p>
        </div>

        {/* Center: Aggregate stats */}
        {hasStats && card.stats && (
          <div className="flex justify-center items-center gap-6 rounded-lg bg-slate-50/80 px-4 py-2">
            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mean</div>
              <div className="text-lg font-bold text-slate-800">{formatNumericStat(card.stats.mean)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Median</div>
              <div className="text-lg font-bold text-slate-800">{formatNumericStat(card.stats.median)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mode</div>
              <div className="text-lg font-bold text-slate-800">{formatNumericStat(card.stats.mode)}</div>
            </div>
          </div>
        )}

        {/* Right: Export button */}
        {canExportTables ? (
          <button
            type="button"
            onClick={() => downloadCsv(`listing-analysis-${card.variable}.csv`, exportRows)}
            disabled={exportRows.length === 0}
            title="Download CSV"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Download className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Body */}
      {card.tableRows.length > 0 ? (
        <div>
          <div className="grid grid-cols-[1fr_5rem_6rem_10rem] gap-x-3 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Answer</span>
            <span className="text-right">Count</span>
            <span className="text-right">%</span>
            <span />
          </div>
          <div>
            {card.tableRows.map((row, idx) => (
              <div
                key={`${card.variable}-${row.code}-${idx}`}
                className={`grid grid-cols-[1fr_5rem_6rem_10rem] items-center gap-x-3 border-b border-slate-50 px-5 py-3 last:border-b-0 hover:bg-slate-50/60 ${row.count > 0 && onAnswerClick ? "cursor-pointer hover:bg-sky-50/70" : ""}`}
                onClick={row.count > 0 && onAnswerClick ? () => onAnswerClick(row, card) : undefined}
              >
                <span className="truncate text-sm text-slate-700" title={row.label}>
                  {formatAnswerLabel(row.label)}
                </span>
                <span className="text-right tabular-nums text-sm font-semibold text-slate-900">
                  {row.count.toLocaleString()}
                </span>
                <span className="text-right tabular-nums text-sm text-slate-500">
                  {row.percent.toFixed(1)}%
                </span>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(row.percent, 100)}%`,
                      backgroundColor: BAR_COLORS[idx % BAR_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">No data available.</div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ListingAnalysisPage() {
  const { token, user } = useAuth();
  const canExportTables = Boolean(user);
  const navigate = useNavigate();
  const [activeStates, setActiveStates] = useState<string[]>([]);
  const [activeEaIds, setActiveEaIds] = useState<string[]>([]);

  // All states (always loaded)
  const filterQuery = useQuery({
    queryKey: ["listing-analysis-filter-options"],
    queryFn: () =>
      apiFetch<ListingAnalysisFilterOptions>("/api/listing/analysis/filter-options", {}, token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });

  // EAs filtered by selected states — only fetch when at least one state is selected
  const singleStateForEas = activeStates.length === 1 ? activeStates[0] : "";
  const eaOptionsQuery = useQuery({
    queryKey: ["listing-analysis-ea-options", singleStateForEas],
    queryFn: () => {
      const qs = `?state=${encodeURIComponent(singleStateForEas)}`;
      return apiFetch<ListingAnalysisFilterOptions>(
        `/api/listing/analysis/filter-options${qs}`,
        {},
        token,
      );
    },
    enabled: Boolean(token && singleStateForEas),
    staleTime: 5 * 60 * 1000,
  });

  function handleStatesChange(states: string[]) {
    setActiveStates(states);
    setActiveEaIds([]); // reset EAs whenever state selection changes
  }

  // Main analysis data
  const dataQuery = useQuery({
    queryKey: ["listing-analysis", activeStates, activeEaIds],
    queryFn: () => {
      const params = new URLSearchParams();
      activeStates.forEach((s) => params.append("state", s));
      activeEaIds.forEach((id) => params.append("ea_id", id));
      const qs = params.toString();
      return apiFetch<ListingAnalysisPayload>(
        `/api/listing/analysis${qs ? `?${qs}` : ""}`,
        {},
        token,
      );
    },
    enabled: Boolean(token),
  });

  const eas = singleStateForEas
    ? (eaOptionsQuery.data?.eas ?? [])
    : (filterQuery.data?.eas ?? []);

  const activeFilterCount = activeStates.length + activeEaIds.length;

  function clearFilters() {
    setActiveStates([]);
    setActiveEaIds([]);
  }

  const syncLabel = dataQuery.isLoading
    ? "Loading analysis…"
    : dataQuery.data
      ? `${dataQuery.data.totalHouseholds.toLocaleString()} households`
      : "Listing Analysis";

  return (
    <PlatformPage
      title="Listing Analysis"
      subtitle="Distribution tables for household demographic fields"
      syncLabel={syncLabel}
      module="listing"
      plainTopBar={false}
      hideTopBar={true}
    >
      <div className="listing-analysis-stage pt-0">
        {/* ── Sticky filter bar ── */}
        <div className="sticky top-0 z-20 rounded-[1.2rem] -mx-1 mb-6 bg-white/80 px-4 pb-4 pt-3 shadow-[0_4px_24px_rgba(148,163,184,0.12)] backdrop-blur-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 shrink-0 items-center rounded-xl border border-blue-100 bg-blue-50 px-4 text-sm font-black tracking-[-0.02em] text-blue-700 shadow-sm md:h-14">
              3 Categories QC Platform
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500">
                Listing Survey
              </p>
              <h2 className="text-[1.6rem] font-semibold tracking-tight text-slate-950 md:text-[1.9rem]">
                Listing Analysis
              </h2>
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                <Filter className="h-3.5 w-3.5 text-sky-700" />
                Filters
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[11px] font-medium text-rose-600 transition-colors hover:text-rose-700"
                >
                  Clear selection(s)
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {/* State filter */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  State
                </span>
                <MultiSelectDropdown
                  label="States"
                  options={(filterQuery.data?.states ?? []).map((s) => ({ value: s, label: s }))}
                  selected={activeStates}
                  onChange={handleStatesChange}
                  disabled={!filterQuery.data?.states.length}
                />
              </div>

              {/* EA filter — available when exactly one state selected */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Enumeration Area
                </span>
                <MultiSelectDropdown
                  label="Wards"
                  options={eas.map((ea) => ({ value: ea.ea_id, label: ea.ea_name }))}
                  selected={activeEaIds}
                  onChange={setActiveEaIds}
                  disabled={activeStates.length !== 1 || eas.length === 0}
                />
              </div>
            </div>

            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              {activeFilterCount > 0
                ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"} applied`
                : "No filters active — showing all households"}
            </p>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="space-y-4 px-1">
          {dataQuery.isLoading ? (
            <EmptyState
              title="Loading analysis"
              message="Aggregating household demographic distributions…"
            />
          ) : dataQuery.isError ? (
            <EmptyState
              title="Analysis unavailable"
              message={
                dataQuery.error instanceof Error
                  ? dataQuery.error.message
                  : "Request failed."
              }
            />
          ) : dataQuery.data ? (
            dataQuery.data.cards.length > 0 ? (
              dataQuery.data.cards.map((card) => (
                <QuestionDistributionCard
                  key={card.variable}
                  card={card}
                  canExportTables={canExportTables}
                  onAnswerClick={(row, sourceCard) => {
                    const nextState: BreakdownState = {
                      module: "listing",
                      questionLabel: sourceCard.label,
                      questionVariable: sourceCard.variable,
                      fieldKey: sourceCard.variable,
                      answerLabel: formatAnswerLabel(row.label),
                      answerCode: formatAnswerLabel(row.code),
                      filterState: activeStates[0] || undefined,
                      filterEaId: activeEaIds[0] || undefined,
                      allowFreeformEdit: Boolean(sourceCard.stats),
                    };
                    navigate("/listing/analysis-breakdown", { state: nextState });
                  }}
                />
              ))
            ) : (
              <EmptyState title="No data" message="No household records match the current filters." />
            )
          ) : null}
        </div>
      </div>
    </PlatformPage>
  );
}
