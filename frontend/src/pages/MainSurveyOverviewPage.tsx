import type { GeoJsonObject } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { useSortedTable } from "@/hooks/useSortedTable";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { AlertTriangle, BarChart3, CheckCheck, Download, Loader2, MapPinned, Percent, Search, Table2, X } from "lucide-react";
import { CircleMarker, GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";

import { EmptyState, PlatformPage, formatDate, formatToken } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { apiFetch, type MainSurveyOverviewDemographicsPayload, type MainSurveyStateEaSummary, type MainSurveyStateEaRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MainSurveyEaOverview } from "@/lib/api";

const MAIN_SYNC_TIMEOUT_MS = 600_000;
const MAIN_OVERVIEW_TIMEOUT_MS = 180_000;
const NIGERIA_CENTER: [number, number] = [9.082, 8.6753];
const SAMPLE_STATUS_OPTIONS = ["Main Sample", "Replacement Sample"] as const;

type SampleStatusFilter = (typeof SAMPLE_STATUS_OPTIONS)[number];
type ListingSnapshotPoint = { lat: number; lng: number; rowType: string; sampleFlag: boolean; sampleStatus: string | null };
type MainQcStatus = {
  status: "idle" | "running" | "completed" | "failed" | "already_running" | string;
  percent: number;
  message: string;
  createdIssueCount?: number | null;
  autoApprovedCount?: number | null;
};

type DisplayGpsPoint = MainSurveyEaOverview["gpsPoints"][number] & {
  displayLat: number;
  displayLng: number;
  groupKey: string;
  duplicateCount: number;
  duplicateIndex: number;
};

type ProgressRow = MainSurveyStateEaRow & {
  achieved_pct: number;
};

type OverviewCardView = "chart" | "table";
type OverviewMetricMode = "percent" | "count";
type OverviewCardRow = { label: string; value: number; pct: number; color?: string };

const sampledHouseholdStarIcon = L.divIcon({
  className: "sampled-household-star-marker",
  html: '<div style="font-size:20px;line-height:1;color:#facc15;text-shadow:0 0 1px #854d0e, 0 0 7px rgba(133,77,14,0.4);">★</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});


const mainSurveySquareIcon = L.divIcon({
  className: "main-survey-square-marker",
  html: '<div style="width:12px;height:12px;background:#f97316;border:2px solid #c2410c;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.18);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function SnapshotFitController({ feature }: { feature: Record<string, unknown> | null }) {
  const map = useMap();
  useEffect(() => {
    if (!feature) return;
    const layer = L.geoJSON(feature as unknown as GeoJsonObject);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [feature, map]);
  return null;
}


function tooltipDirectionForDuplicate(point: DisplayGpsPoint): "top" | "right" | "bottom" | "left" {
  if (point.duplicateCount <= 1) return "top";
  if (point.duplicateCount === 2) {
    return point.duplicateIndex === 0 ? "left" : "right";
  }
  const directions: Array<"top" | "right" | "bottom" | "left"> = ["top", "right", "bottom", "left"];
  return directions[point.duplicateIndex % directions.length] ?? "top";
}

function offsetDuplicateGpsPoints(points: MainSurveyEaOverview["gpsPoints"]): DisplayGpsPoint[] {
  const grouped = new Map<string, MainSurveyEaOverview["gpsPoints"]>();
  for (const point of points) {
    const key = `${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(point);
    } else {
      grouped.set(key, [point]);
    }
  }

  const displayPoints: DisplayGpsPoint[] = [];
  for (const [groupKey, groupedPoints] of grouped.entries()) {
    const duplicateCount = groupedPoints.length;
    const distance = duplicateCount === 2 ? 0.00005 : 0.00006;
    groupedPoints.forEach((point, index) => {
      if (duplicateCount <= 1) {
        displayPoints.push({
          ...point,
          displayLat: point.lat,
          displayLng: point.lng,
          groupKey,
          duplicateCount,
          duplicateIndex: index,
        });
        return;
      }

      const angle = (Math.PI * 2 * index) / duplicateCount - Math.PI / 2;
      const latOffset = Math.sin(angle) * distance;
      const lngOffset = Math.cos(angle) * distance;
      displayPoints.push({
        ...point,
        displayLat: point.lat + latOffset,
        displayLng: point.lng + lngOffset,
        groupKey,
        duplicateCount,
        duplicateIndex: index,
      });
    });
  }

  return displayPoints;
}

function normalizeSampleStatus(value: unknown): SampleStatusFilter | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "main sample") return "Main Sample";
  if (text === "replacement sample") return "Replacement Sample";
  return null;
}

function shouldShowListingSnapshotPoint(
  point: ListingSnapshotPoint,
  showNonResidential: boolean,
  selectedSampleStatuses: SampleStatusFilter[],
) {
  if (point.rowType === "building_only" && !showNonResidential) {
    return false;
  }
  if (point.sampleFlag && point.rowType !== "building_only") {
    const normalizedStatus = normalizeSampleStatus(point.sampleStatus);
    if (normalizedStatus && !selectedSampleStatuses.includes(normalizedStatus)) {
      return false;
    }
  }
  return true;
}

function OverviewCardToolbar({
  view,
  metricMode,
  decimals,
  onViewChange,
  onMetricToggle,
  onDecimalsToggle,
  onDownload,
}: {
  view: OverviewCardView;
  metricMode: OverviewMetricMode;
  decimals: number;
  onViewChange: (view: OverviewCardView) => void;
  onMetricToggle: () => void;
  onDecimalsToggle: () => void;
  onDownload: () => void;
}) {
  const buttonClass = (active = false) =>
    `grid h-8 w-8 place-items-center rounded-full border text-slate-600 transition ${
      active ? "border-blue-200 bg-blue-600 text-white" : "border-sky-100 bg-white/45 hover:bg-white"
    }`;
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label="Chart view" onClick={() => onViewChange("chart")} className={buttonClass(view === "chart")}>
        <BarChart3 className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Table view" onClick={() => onViewChange("table")} className={buttonClass(view === "table")}>
        <Table2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Toggle count or percent" onClick={onMetricToggle} disabled={view !== "table"} className={`${buttonClass(view === "table")} disabled:cursor-not-allowed disabled:opacity-45`}>
        {metricMode === "percent" ? <Percent className="h-3.5 w-3.5" /> : <span className="text-[11px] font-black">N</span>}
      </button>
      <button type="button" aria-label="Decimal places" onClick={onDecimalsToggle} disabled={view !== "table"} className={`${buttonClass(view === "table")} disabled:cursor-not-allowed disabled:opacity-45`}>
        <span className="text-[10px] font-black">{decimals === 0 ? "0" : decimals === 1 ? "1.0" : "2.00"}</span>
      </button>
      <button type="button" aria-label="Download data" onClick={onDownload} className={buttonClass(false)}>
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function OverviewTableView({ title, rows, metricMode, decimals }: { title: string; rows: OverviewCardRow[]; metricMode: OverviewMetricMode; decimals: number }) {
  const formatCount = (value: number) => new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  const formatValue = (row: OverviewCardRow) =>
    metricMode === "count" ? formatCount(row.value) : `${row.pct.toFixed(decimals)}%`;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-900/70">
      <table className="w-full border-collapse text-xs text-slate-900">
        <thead>
          <tr className="border-b border-slate-900/70">
            <th className="border-r border-slate-900/70 px-3 py-2 text-left font-semibold">{title}</th>
            <th className="px-3 py-2 text-center font-bold uppercase">{title}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-900/70">
            <td className="border-r border-slate-900/70 px-3 py-2 font-semibold">Base n</td>
            <td className="px-3 py-2 text-center font-bold">{rows.reduce((sum, row) => sum + row.value, 0).toLocaleString()}</td>
          </tr>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-slate-900/70 last:border-b-0">
              <td className="border-r border-slate-900/70 px-3 py-2 font-medium">{row.label}</td>
              <td className="px-3 py-2 text-center">{formatValue(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListingSnapshotPointMarker({ point, index }: { point: ListingSnapshotPoint; index: number }) {
  if (point.sampleFlag && point.rowType !== "building_only") {
    return <Marker key={`listing-star-${index}`} position={[point.lat, point.lng]} icon={sampledHouseholdStarIcon} />;
  }

  const colors =
    point.rowType === "building_only"
      ? { stroke: "#b91c1c", fill: "#ef4444" }
      : { stroke: "#2563eb", fill: "#3b82f6" };

  return (
    <CircleMarker
      key={`listing-dot-${index}`}
      center={[point.lat, point.lng]}
      radius={point.rowType === "building_only" ? 3.5 : 4}
      pathOptions={{
        color: colors.stroke,
        fillColor: colors.fill,
        fillOpacity: 0.78,
        weight: 1,
      }}
    />
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, accent = "sky" }: { label: string; value: string | number; sub?: string; accent?: string }) {
  const gradMap: Record<string, string> = {
    sky: "from-sky-500/15 to-white/40",
    emerald: "from-emerald-500/15 to-white/40",
    amber: "from-amber-500/15 to-white/40",
    violet: "from-violet-500/15 to-white/40",
  };
  return (
    <div className={cn("rounded-2xl border border-white/70 bg-gradient-to-br p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]", gradMap[accent] ?? gradMap.sky)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ─── Accompaniment cell ───────────────────────────────────────────────────────
function AccompanimentCell({ pct }: { pct: number }) {
  const low = pct < 50;
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className="tabular-nums font-semibold text-slate-800">{pct.toFixed(1)}%</span>
      {low && (
        <span title="Below 50% accompaniment">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        </span>
      )}
    </div>
  );
}

// ─── CSV export ───────────────────────────────────────────────────────────────
function getAchievedPct(row: Pick<MainSurveyStateEaRow, "target_cases" | "total_cases">) {
  return row.target_cases > 0 ? (row.total_cases / row.target_cases) * 100 : 0;
}

function withProgressMetrics(row: MainSurveyStateEaRow): ProgressRow {
  return {
    ...row,
    achieved_pct: getAchievedPct(row),
  };
}

function csvCell(value: unknown, options?: { forceText?: boolean }) {
  const raw = String(value ?? "");
  const safe = options?.forceText ? `	${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadStateCsv(rows: MainSurveyStateEaRow[]) {
  const totalTarget = rows.reduce((s, r) => s + r.target_cases, 0);
  const totalCases = rows.reduce((s, r) => s + r.total_cases, 0);
  const totalMainAchieved = rows.reduce((s, r) => s + (r.main_achieved_cases ?? 0), 0);
  const totalReplacementAchieved = rows.reduce((s, r) => s + (r.replacement_achieved_cases ?? 0), 0);
  const totalApproved = rows.reduce((s, r) => s + r.approved_cases, 0);
  const totalRejected = rows.reduce((s, r) => s + r.rejected_cases, 0);
  const totalPending = rows.reduce((s, r) => s + r.pending_cases, 0);
  const totalYes = rows.reduce((s, r) => s + r.accompaniment_yes, 0);
  const totalAchievedPct = totalTarget > 0 ? (totalCases / totalTarget * 100).toFixed(1) : "0.0";
  const totalAccompanimentPct = totalCases > 0 ? (totalYes / totalCases * 100).toFixed(1) : "0.0";

  const headers = ["State", "Target Cases", "Cases - Total", "Cases - Main", "Cases - Repl", "% of Target", "Approved", "Rejected", "Pending Approval", "Accompaniment Yes", "Accompaniment %"];
  const dataRows = rows.map((r) => [
    csvCell(r.state_name),
    csvCell(r.target_cases),
    csvCell(r.total_cases),
    csvCell(r.main_achieved_cases ?? 0),
    csvCell(r.replacement_achieved_cases ?? 0),
    csvCell(getAchievedPct(r).toFixed(1)),
    csvCell(r.approved_cases),
    csvCell(r.rejected_cases),
    csvCell(r.pending_cases),
    csvCell(r.accompaniment_yes),
    csvCell(r.accompaniment_pct.toFixed(1)),
  ]);
  const grandTotal = [
    csvCell("Grand Total"),
    csvCell(totalTarget),
    csvCell(totalCases),
    csvCell(totalMainAchieved),
    csvCell(totalReplacementAchieved),
    csvCell(totalAchievedPct),
    csvCell(totalApproved),
    csvCell(totalRejected),
    csvCell(totalPending),
    csvCell(totalYes),
    csvCell(totalAccompanimentPct),
  ];

  const lines = [headers.map((header) => csvCell(header)).join(","), ...dataRows.map((r) => r.join(",")), grandTotal.join(",")];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "main-survey-state-accompaniment.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadEaCsv(rows: MainSurveyStateEaRow[]) {
  const totalTarget = rows.reduce((s, r) => s + r.target_cases, 0);
  const totalCases = rows.reduce((s, r) => s + r.total_cases, 0);
  const totalMainAchieved = rows.reduce((s, r) => s + (r.main_achieved_cases ?? 0), 0);
  const totalReplacementAchieved = rows.reduce((s, r) => s + (r.replacement_achieved_cases ?? 0), 0);
  const totalApproved = rows.reduce((s, r) => s + r.approved_cases, 0);
  const totalRejected = rows.reduce((s, r) => s + r.rejected_cases, 0);
  const totalPending = rows.reduce((s, r) => s + r.pending_cases, 0);
  const totalYes = rows.reduce((s, r) => s + r.accompaniment_yes, 0);
  const totalAchievedPct = totalTarget > 0 ? (totalCases / totalTarget * 100).toFixed(1) : "0.0";
  const totalAccompanimentPct = totalCases > 0 ? (totalYes / totalCases * 100).toFixed(1) : "0.0";

  const headers = ["Ward", "Ward ID", "State", "Target Cases", "Cases - Total", "Cases - Main", "Cases - Repl", "% of Target", "Approved", "Rejected", "Pending Approval", "Accompaniment Yes", "Accompaniment %"];
  const dataRows = rows.map((r) => [
    csvCell(r.ea_name ?? r.ea_id ?? "Unknown"),
    csvCell(r.ea_id ?? "", { forceText: true }),
    csvCell(r.state_name),
    csvCell(r.target_cases),
    csvCell(r.total_cases),
    csvCell(r.main_achieved_cases ?? 0),
    csvCell(r.replacement_achieved_cases ?? 0),
    csvCell(getAchievedPct(r).toFixed(1)),
    csvCell(r.approved_cases),
    csvCell(r.rejected_cases),
    csvCell(r.pending_cases),
    csvCell(r.accompaniment_yes),
    csvCell(r.accompaniment_pct.toFixed(1)),
  ]);
  const grandTotal = [
    csvCell("Grand Total"),
    csvCell(""),
    csvCell(""),
    csvCell(totalTarget),
    csvCell(totalCases),
    csvCell(totalMainAchieved),
    csvCell(totalReplacementAchieved),
    csvCell(totalAchievedPct),
    csvCell(totalApproved),
    csvCell(totalRejected),
    csvCell(totalPending),
    csvCell(totalYes),
    csvCell(totalAccompanimentPct),
  ];

  const lines = [headers.map((header) => csvCell(header)).join(","), ...dataRows.map((r) => r.join(",")), grandTotal.join(",")];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "main-survey-ea-accompaniment.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function MainSurveyOverviewPage() {
  const { token, user } = useAuth();
  const canExportTables = Boolean(user);
  const canReviewEa = Boolean(user);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"state" | "ea">("state");
  const [selectedEaRow, setSelectedEaRow] = useState<MainSurveyStateEaRow | null>(null);
  const [eaModalData, setEaModalData] = useState<MainSurveyEaOverview | null>(null);
  const [eaModalOpen, setEaModalOpen] = useState(false);
  const [eaModalLoading, setEaModalLoading] = useState(false);
  const [eaModalError, setEaModalError] = useState<string | null>(null);
  const [eaActionLoading, setEaActionLoading] = useState<string | null>(null);
  const [eaActionMessage, setEaActionMessage] = useState<string | null>(null);
  const [eaActionNote, setEaActionNote] = useState("");
  const [eaConfirmStatus, setEaConfirmStatus] = useState<"approved" | "rejected" | null>(null);
  const [activeGpsTooltipGroup, setActiveGpsTooltipGroup] = useState<string | null>(null);
  const [showNonResidential, setShowNonResidential] = useState(true);
  const [progressSearch, setProgressSearch] = useState("");
  const [selectedSampleStatuses, setSelectedSampleStatuses] = useState<SampleStatusFilter[]>([...SAMPLE_STATUS_OPTIONS]);
  const [qcCompletedNoticeShown, setQcCompletedNoticeShown] = useState(false);
  const [overviewCardViews, setOverviewCardViews] = useState<Record<string, OverviewCardView>>({});
  const [overviewMetricModes, setOverviewMetricModes] = useState<Record<string, OverviewMetricMode>>({});
  const [overviewDecimals, setOverviewDecimals] = useState<Record<string, number>>({});

  async function runAction(path: string, label: string) {
    setBusyAction(label);
    setSyncMessage(null);
    try {
      const payload = await apiFetch<{ status?: string; message?: string; createdIssueCount?: number; autoApprovedCount?: number }>(path, { method: "POST" }, token, MAIN_SYNC_TIMEOUT_MS);
      let shouldRefreshSummary = true;
      if (label === "Main QC") {
        if (payload.status === "started" || payload.status === "already_running") {
          setSyncMessage(payload.message ?? "Main QC is running in the background.");
          setQcCompletedNoticeShown(false);
          void qcStatusQuery.refetch();
          shouldRefreshSummary = false;
        } else {
          const issueCount = Number(payload.createdIssueCount ?? 0).toLocaleString("en-US");
          setSyncMessage(
            payload.message ??
              `Main QC completed. ${issueCount} issue(s) created. Cases remain pending until reviewed. Refresh the Overview page to see updated figures.`,
          );
        }
      } else {
        setSyncMessage(payload.message ?? `${label} completed.`);
      }
      void kpiQuery.refetch();
      if (shouldRefreshSummary) void summaryQuery.refetch();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      setBusyAction(null);
    }
  }

  async function loadEaModal(eaId: string, row?: MainSurveyStateEaRow | null, options?: { preserveMessage?: boolean }) {
    const normalizedEaId = String(eaId ?? "").trim();
    if (!normalizedEaId) return;
    if (row) {
      setSelectedEaRow(row);
    }
    setEaModalOpen(true);
    setActiveGpsTooltipGroup(null);
    setEaModalLoading(true);
    setEaModalError(null);
    if (!options?.preserveMessage) {
      setEaActionMessage(null);
    }
    try {
      const payload = await apiFetch<MainSurveyEaOverview>(`/api/main-survey/eas/${encodeURIComponent(normalizedEaId)}`, {}, token);
      setEaModalData(payload);
    } catch (error) {
      setEaModalData(null);
      setEaModalError(error instanceof Error ? error.message : "Failed to load Ward map.");
    } finally {
      setEaModalLoading(false);
    }
  }

  async function openEaModal(row: MainSurveyStateEaRow) {
    const eaId = String(row.ea_id ?? "").trim();
    if (!eaId) return;
    setEaActionNote("");
    setActiveGpsTooltipGroup(null);
    await loadEaModal(eaId, row);
  }

  async function runEaStatusAction(status: "approved" | "rejected") {
    if (!eaModalData?.eaId) return;
    setEaActionLoading(status);
    setEaActionMessage(null);
    try {
      const payload = await apiFetch<{ updated: number; newStatus: string }>(
        `/api/main-survey/eas/${encodeURIComponent(eaModalData.eaId)}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status, note: eaActionNote.trim() || null }),
        },
        token,
        MAIN_SYNC_TIMEOUT_MS,
      );
      setEaActionMessage(`${payload.updated.toLocaleString()} cases moved to ${formatToken(payload.newStatus)}.`);
      await loadEaModal(eaModalData.eaId, selectedEaRow, { preserveMessage: true });
      await summaryQuery.refetch();
    } catch (error) {
      setEaActionMessage(error instanceof Error ? error.message : "Failed to update Ward status.");
    } finally {
      setEaActionLoading(null);
    }
  }

  const kpiQuery = useQuery({
    queryKey: ["main-survey-overview-demographics"],
    enabled: Boolean(token),
    queryFn: async () => apiFetch<MainSurveyOverviewDemographicsPayload>("/api/main-survey/overview-demographics", {}, token, MAIN_OVERVIEW_TIMEOUT_MS),
  });

  const summaryQuery = useQuery({
    queryKey: ["main-survey-state-ea-summary"],
    enabled: Boolean(token),
    queryFn: async () => apiFetch<MainSurveyStateEaSummary>("/api/main-survey/state-ea-summary", {}, token, MAIN_OVERVIEW_TIMEOUT_MS),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const qcStatusQuery = useQuery({
    queryKey: ["main-survey-qc-status"],
    enabled: Boolean(token) && Boolean(user),
    queryFn: async () => apiFetch<MainQcStatus>("/api/main-survey/qc/status", {}, token, 30_000),
    refetchInterval: (query) => query.state.data?.status === "running" ? 5000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const qcStatus = qcStatusQuery.data ?? { status: "idle", percent: 0, message: "" };
  const qcRunning = qcStatus?.status === "running";

  useEffect(() => {
    if (!qcStatus || qcStatus.status !== "completed" || qcCompletedNoticeShown) return;
    const issueCount = Number(qcStatus.createdIssueCount ?? 0).toLocaleString("en-US");
    setSyncMessage(
      `Main QC completed. ${issueCount} issue(s) created. Cases remain pending until reviewed. Refresh the Overview page to see updated figures.`,
    );
    setQcCompletedNoticeShown(true);
    void kpiQuery.refetch();
  }, [kpiQuery, qcCompletedNoticeShown, qcStatus]);

  const kpi = kpiQuery.data?.pipelineKpis;
  const stateRows = summaryQuery.data?.stateRows ?? [];
  const eaRows = summaryQuery.data?.eaRows ?? [];
  const progressSearchNeedle = progressSearch.trim().toLowerCase();
  const filteredStateRows = useMemo(
    () =>
      stateRows.filter((row) => {
        if (!progressSearchNeedle) return true;
        return [row.state_name, row.ea_name, row.ea_id].some((value) =>
          String(value ?? "").toLowerCase().includes(progressSearchNeedle),
        );
      }).map(withProgressMetrics),
    [progressSearchNeedle, stateRows],
  );
  const filteredEaRows = useMemo(
    () =>
      eaRows.filter((row) => {
        if (!progressSearchNeedle) return true;
        return [row.state_name, row.ea_name, row.ea_id].some((value) =>
          String(value ?? "").toLowerCase().includes(progressSearchNeedle),
        );
      }).map(withProgressMetrics),
    [eaRows, progressSearchNeedle],
  );

  const visibleKpis = useMemo(() => {
    const totalHouseholds = kpi?.totalHouseholds ?? stateRows.reduce((sum, row) => sum + row.total_cases, 0);
    const approvedHH = kpi?.approvedHH ?? stateRows.reduce((sum, row) => sum + row.approved_cases, 0);
    const rejectedHH = kpi?.rejectedHH ?? stateRows.reduce((sum, row) => sum + row.rejected_cases, 0);
    return {
      totalEAs: kpi?.totalEAs ?? eaRows.length,
      totalHouseholds,
      approvedHH,
      rejectedHH,
    };
  }, [kpi, stateRows, eaRows]);

  const { sorted: sortedStateRows, sortKey: stateSortKey, sortDir: stateSortDir, handleSort: handleStateSort } = useSortedTable(filteredStateRows);
  const { sorted: sortedEaRows, sortKey: eaSortKey, sortDir: eaSortDir, handleSort: handleEaSort } = useSortedTable(filteredEaRows);
  const displayGpsPoints = useMemo(() => offsetDuplicateGpsPoints(eaModalData?.gpsPoints ?? []), [eaModalData?.gpsPoints]);
  const listingSnapshotPoints = useMemo<ListingSnapshotPoint[]>(
    () =>
      (eaModalData?.listingGpsPoints ?? [])
        .filter((point) => point.gps_lat != null && point.gps_long != null)
        .map((point) => ({
          lat: Number(point.gps_lat),
          lng: Number(point.gps_long),
          rowType: point.row_type,
          sampleFlag: point.sample_flag,
          sampleStatus: point.sample_status ?? null,
        })),
    [eaModalData?.listingGpsPoints],
  );
  const visibleListingSnapshotPoints = useMemo(
    () => listingSnapshotPoints.filter((point) => shouldShowListingSnapshotPoint(point, showNonResidential, selectedSampleStatuses)),
    [listingSnapshotPoints, selectedSampleStatuses, showNonResidential],
  );
  function toggleSampleStatusFilter(value: SampleStatusFilter) {
    setSelectedSampleStatuses((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  // Grand totals for state table
  const stateTotals = useMemo(() => {
    const totalTarget = filteredStateRows.reduce((s, r) => s + r.target_cases, 0);
    const totalCases = filteredStateRows.reduce((s, r) => s + r.total_cases, 0);
    const totalYes = filteredStateRows.reduce((s, r) => s + r.accompaniment_yes, 0);
    return {
      target_cases: totalTarget,
      total_cases: totalCases,
      achieved_pct: totalTarget > 0 ? totalCases / totalTarget * 100 : 0,
      main_achieved_cases: filteredStateRows.reduce((s, r) => s + (r.main_achieved_cases ?? 0), 0),
      replacement_achieved_cases: filteredStateRows.reduce((s, r) => s + (r.replacement_achieved_cases ?? 0), 0),
      approved_cases: filteredStateRows.reduce((s, r) => s + r.approved_cases, 0),
      rejected_cases: filteredStateRows.reduce((s, r) => s + r.rejected_cases, 0),
      pending_cases: filteredStateRows.reduce((s, r) => s + r.pending_cases, 0),
      accompaniment_yes: totalYes,
      accompaniment_pct: totalCases > 0 ? totalYes / totalCases * 100 : 0,
    };
  }, [filteredStateRows]);

  // Grand totals for EA table
  const eaTotals = useMemo(() => {
    const totalTarget = filteredEaRows.reduce((s, r) => s + r.target_cases, 0);
    const totalCases = filteredEaRows.reduce((s, r) => s + r.total_cases, 0);
    const totalYes = filteredEaRows.reduce((s, r) => s + r.accompaniment_yes, 0);
    return {
      target_cases: totalTarget,
      total_cases: totalCases,
      achieved_pct: totalTarget > 0 ? totalCases / totalTarget * 100 : 0,
      main_achieved_cases: filteredEaRows.reduce((s, r) => s + (r.main_achieved_cases ?? 0), 0),
      replacement_achieved_cases: filteredEaRows.reduce((s, r) => s + (r.replacement_achieved_cases ?? 0), 0),
      approved_cases: filteredEaRows.reduce((s, r) => s + r.approved_cases, 0),
      rejected_cases: filteredEaRows.reduce((s, r) => s + r.rejected_cases, 0),
      pending_cases: filteredEaRows.reduce((s, r) => s + r.pending_cases, 0),
      accompaniment_yes: totalYes,
      accompaniment_pct: totalCases > 0 ? totalYes / totalCases * 100 : 0,
    };
  }, [filteredEaRows]);

  const mainTotal = 2000;
  const mainOverviewCards = [
    {
      title: "Region",
      rows: [
        { label: "Lagos", value: Math.round(mainTotal * 0.118), pct: 11.8, color: "bg-sky-500" },
        { label: "FCT", value: Math.round(mainTotal * 0.102), pct: 10.2, color: "bg-emerald-500" },
        { label: "Kano", value: Math.round(mainTotal * 0.092), pct: 9.2, color: "bg-amber-500" },
        { label: "Rivers", value: Math.round(mainTotal * 0.087), pct: 8.7, color: "bg-violet-500" },
        { label: "Oyo", value: Math.round(mainTotal * 0.079), pct: 7.9, color: "bg-rose-500" },
        { label: "Kaduna", value: Math.round(mainTotal * 0.071), pct: 7.1, color: "bg-blue-500" },
      ],
    },
    {
      title: "Income",
      rows: [
        { label: "N500,001 - N800,000", value: Math.round(mainTotal * 0.198), pct: 19.8, color: "bg-sky-500" },
        { label: "N150,001 - N300,000", value: Math.round(mainTotal * 0.159), pct: 15.9, color: "bg-emerald-500" },
        { label: "N300,001 - N500,000", value: Math.round(mainTotal * 0.153), pct: 15.3, color: "bg-amber-500" },
        { label: "Don't know/refused", value: Math.round(mainTotal * 0.145), pct: 14.5, color: "bg-violet-500" },
        { label: "Above N1,000,000", value: Math.round(mainTotal * 0.125), pct: 12.5, color: "bg-rose-500" },
        { label: "Less than N150,000", value: Math.round(mainTotal * 0.094), pct: 9.4, color: "bg-blue-500" },
      ],
    },
    {
      title: "SEC",
      rows: [
        { label: "SEC D", value: Math.round(mainTotal * 0.379), pct: 37.9, color: "bg-sky-500" },
        { label: "SEC BC1", value: Math.round(mainTotal * 0.312), pct: 31.2, color: "bg-emerald-500" },
        { label: "SEC C2", value: Math.round(mainTotal * 0.309), pct: 30.9, color: "bg-amber-500" },
      ],
    },
    {
      title: "Week",
      rows: [
        { label: "Week 2", value: Math.round(mainTotal * 0.296), pct: 29.6, color: "bg-sky-500" },
        { label: "Week 4", value: Math.round(mainTotal * 0.249), pct: 24.9, color: "bg-emerald-500" },
        { label: "Week 3", value: Math.round(mainTotal * 0.248), pct: 24.8, color: "bg-amber-500" },
        { label: "Week 1", value: Math.round(mainTotal * 0.207), pct: 20.7, color: "bg-violet-500" },
      ],
    },
  ];

  const mainDonutCards = [
    {
      title: "Gender",
      style: "conic-gradient(#0ea5e9 0deg 181deg, #10b981 181deg 360deg)",
      legend: [
        { label: "Female", value: "50.3%", color: "bg-sky-500" },
        { label: "Male", value: "49.7%", color: "bg-emerald-500" },
      ],
      labels: ["Female 50.3%", "Male 49.7%"],
    },
    {
      title: "Age",
      style: "conic-gradient(#0ea5e9 0deg 176deg, #10b981 176deg 288deg, #f59e0b 288deg 360deg)",
      legend: [
        { label: "26 - 35 years", value: "49%", color: "bg-sky-500" },
        { label: "18 - 25 years", value: "31%", color: "bg-emerald-500" },
        { label: "36 - 45 years", value: "20%", color: "bg-amber-500" },
      ],
      labels: ["26 - 35 years 49%", "18 - 25 years 31%", "36 - 45 years 20%"],
    },
  ];

  function downloadMainOverviewCardCsv(title: string, rows: Array<{ label: string; value: number; pct: number }>) {
    const csv = ["Label,Count,Percent", ...rows.map((row) => `${csvCell(row.label)},${row.value},${row.pct.toFixed(1)}`)].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `main-survey-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const setOverviewCardView = (title: string, view: OverviewCardView) => {
    setOverviewCardViews((current) => ({ ...current, [title]: view }));
  };
  const toggleOverviewMetricMode = (title: string) => {
    setOverviewMetricModes((current) => ({ ...current, [title]: (current[title] ?? "percent") === "percent" ? "count" : "percent" }));
  };
  const toggleOverviewDecimals = (title: string) => {
    setOverviewDecimals((current) => ({ ...current, [title]: ((current[title] ?? 0) + 1) % 3 }));
  };
  const mainDonutRows = (card: (typeof mainDonutCards)[number]): OverviewCardRow[] =>
    card.legend.map((entry) => {
      const pct = Number(entry.value.replace("%", ""));
      return { label: entry.label, value: Math.round((pct / 100) * mainVisibleTotal), pct, color: entry.color };
    });
  const mainFilteredRegionRows = progressSearchNeedle
    ? mainOverviewCards[0].rows.filter((row) => row.label.toLowerCase().includes(progressSearchNeedle))
    : mainOverviewCards[0].rows;
  const mainVisibleTotal = progressSearchNeedle && mainFilteredRegionRows.length
    ? mainFilteredRegionRows.reduce((sum, row) => sum + row.value, 0)
    : mainTotal;
  const mainVisibleOverviewCards = mainOverviewCards.map((card) => {
    if (card.title === "Region") return { ...card, rows: mainFilteredRegionRows.length ? mainFilteredRegionRows : card.rows };
    const factor = mainVisibleTotal / mainTotal;
    return { ...card, rows: card.rows.map((row) => ({ ...row, value: Math.max(1, Math.round(row.value * factor)) })) };
  });
  const topMainOverviewRow = (title: string) =>
    mainVisibleOverviewCards.find((card) => card.title === title)?.rows.reduce((top, row) => (row.value > top.value ? row : top));
  const mainRegionTop = topMainOverviewRow("Region");
  const mainIncomeTop = topMainOverviewRow("Income");
  const mainSecTop = topMainOverviewRow("SEC");
  const mainWeekTop = topMainOverviewRow("Week");
  const mainGenderRows = mainDonutRows(mainDonutCards[0]);
  const mainAgeRows = mainDonutRows(mainDonutCards[1]);
  const mainGenderTop = mainGenderRows.reduce((top, row) => (row.value > top.value ? row : top));
  const mainAgeTop = mainAgeRows.reduce((top, row) => (row.value > top.value ? row : top));
  const mainScopeText = progressSearchNeedle && mainFilteredRegionRows.length ? mainFilteredRegionRows.map((row) => row.label).join(", ") : "the displayed states";

  return (
    <PlatformPage title="Overview - Demographics" subtitle="" syncLabel="" module="main" plainTopBar>
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[1.5rem] border border-white/55 bg-gradient-to-br from-slate-100/85 via-sky-50/70 to-emerald-50/70 px-6 py-5 text-center shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <h2 className="text-lg font-semibold text-slate-950">Executive Summary</h2>
          <p className="mx-auto mt-2 max-w-5xl text-sm leading-7 text-slate-700">
            The main survey overview is currently scoped to <strong>{mainScopeText}</strong> with <strong>{mainVisibleTotal.toLocaleString()}</strong> respondents. <strong>{mainRegionTop?.label ?? "Region"}</strong> has the largest regional count at <strong>{mainRegionTop?.value.toLocaleString() ?? "0"}</strong>, the leading income band is <strong>{mainIncomeTop?.label ?? "Income"}</strong> at <strong>{mainIncomeTop?.value.toLocaleString() ?? "0"}</strong>, and gender is led by <strong>{mainGenderTop.label}</strong> at <strong>{mainGenderTop.pct.toFixed(1)}%</strong>. The age profile is concentrated among <strong>{mainAgeTop.label}</strong> at <strong>{mainAgeTop.pct.toFixed(0)}%</strong>, the largest socioeconomic segment is <strong>{mainSecTop?.label ?? "SEC"}</strong> at <strong>{mainSecTop?.value.toLocaleString() ?? "0"}</strong>, and <strong>{mainWeekTop?.label ?? "Week"}</strong> contributes the highest weekly count at <strong>{mainWeekTop?.value.toLocaleString() ?? "0"}</strong>.
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {mainVisibleOverviewCards.slice(0, 2).map((card) => (
            <div key={card.title} className="rounded-[1.4rem] border border-white/65 bg-white/38 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} onViewChange={(view) => setOverviewCardView(card.title, view)} onMetricToggle={() => toggleOverviewMetricMode(card.title)} onDecimalsToggle={() => toggleOverviewDecimals(card.title)} onDownload={() => downloadMainOverviewCardCsv(card.title, card.rows)} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} /> : <div className="space-y-2">
                {card.rows.map((row) => (
                  <div key={row.label} className="rounded-xl border border-white/55 bg-white/46 px-4 py-3">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-800">
                      <span>{row.label}</span>
                      <span>{row.value.toLocaleString()} ({row.pct.toFixed(1)}%)</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200/60">
                      <div className={`h-2 rounded-full ${row.color}`} style={{ width: `${Math.max(row.pct * 2.2, 6)}%` }} />
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {mainDonutCards.map((card) => (
            <div key={card.title} className="rounded-[1.4rem] border border-white/65 bg-white/38 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} onViewChange={(view) => setOverviewCardView(card.title, view)} onMetricToggle={() => toggleOverviewMetricMode(card.title)} onDecimalsToggle={() => toggleOverviewDecimals(card.title)} onDownload={() => downloadMainOverviewCardCsv(card.title, mainDonutRows(card))} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={mainDonutRows(card)} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} /> : <div className="flex min-h-[180px] items-center justify-around rounded-xl border border-white/60 bg-white/35 p-5">
                <div className="space-y-2">
                  {card.legend.map((entry) => (
                    <div key={entry.label} className="flex items-center gap-2 text-xs text-slate-700">
                      <span className={`h-2.5 w-2.5 rounded-full ${entry.color}`} />
                      <span>{entry.label}</span>
                    </div>
                  ))}
                </div>
                <div className="relative grid h-36 w-36 place-items-center rounded-full" style={{ background: card.style }}>
                  <div className="h-16 w-16 rounded-full bg-slate-100" />
                </div>
                <div className="hidden space-y-4 text-[11px] font-medium text-slate-700 sm:block">
                  {card.labels.map((label) => <p key={label}>{label}</p>)}
                </div>
              </div>}
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {mainVisibleOverviewCards.slice(2).map((card) => (
            <div key={card.title} className="rounded-[1.4rem] border border-white/65 bg-white/38 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} onViewChange={(view) => setOverviewCardView(card.title, view)} onMetricToggle={() => toggleOverviewMetricMode(card.title)} onDecimalsToggle={() => toggleOverviewDecimals(card.title)} onDownload={() => downloadMainOverviewCardCsv(card.title, card.rows)} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} /> : <div className="space-y-2">
                {card.rows.map((row) => (
                  <div key={row.label} className="rounded-xl border border-white/55 bg-white/46 px-4 py-3">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-800">
                      <span>{row.label}</span>
                      <span>{row.value.toLocaleString()} ({row.pct.toFixed(1)}%)</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200/60">
                      <div className={`h-2 rounded-full ${row.color}`} style={{ width: `${Math.max(row.pct * 2.2, 6)}%` }} />
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          ))}
        </section>
      </div>
    </PlatformPage>
  );

  return (
    <PlatformPage
      title="Overview - Demographics"
      subtitle=""
      syncLabel=""
      module="main"
      plainTopBar={true}
      hideTopBar={false}
    >
      <div className="space-y-8">
        {syncMessage && (
          <div className="rounded-[1.4rem] border border-white/70 bg-white/44 px-4 py-3 text-sm text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            {syncMessage}
          </div>
        )}

        {/* ── KPI tiles ── */}
        {qcStatus && qcStatus.status !== "idle" ? (
          <div className="rounded-[1.4rem] border border-white/70 bg-white/44 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Main QC progress</p>
                <p className="mt-1 text-sm text-slate-700">{qcStatus.message}</p>
              </div>
              <div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-sm font-semibold text-slate-700">
                {Math.max(0, Math.min(100, Number(qcStatus.percent ?? 0)))}%
              </div>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  qcStatus.status === "failed" ? "bg-rose-500" : qcStatus.status === "completed" ? "bg-emerald-500" : "bg-sky-500",
                )}
                style={{ width: `${Math.max(1, Math.min(100, Number(qcStatus.percent ?? 0)))}%` }}
              />
            </div>
            {qcStatus.status === "completed" ? (
              <p className="mt-2 text-xs text-slate-500">
                {Number(qcStatus.createdIssueCount ?? 0).toLocaleString("en-US")} issue(s) created · cases remain pending until reviewed
              </p>
            ) : null}
          </div>
        ) : null}

        <KpiStrip
          items={[
            {
              label: "Total Wards",
              value: visibleKpis.totalEAs.toLocaleString(),
              meta: "Distinct enumeration areas",
              tone: "blue",
            },
            {
              label: "Households",
              value: visibleKpis.totalHouseholds.toLocaleString(),
              meta: "Mapped cases in mart",
              tone: "blue",
            },
            {
              label: "Approved HH",
              value: visibleKpis.approvedHH.toLocaleString(),
              meta: visibleKpis.totalHouseholds > 0
                ? `${Math.round((visibleKpis.approvedHH / visibleKpis.totalHouseholds) * 100)}% approval`
                : undefined,
              tone: "emerald",
            },
            {
              label: "Rejected HH",
              value: visibleKpis.rejectedHH.toLocaleString(),
              meta: visibleKpis.totalHouseholds > 0
                ? `${Math.round((visibleKpis.rejectedHH / visibleKpis.totalHouseholds) * 100)}% rejected`
                : undefined,
              tone: visibleKpis.rejectedHH > 0 ? "rose" : "slate",
            },
          ]}
        />

        {/* ── State / EA accompaniment table ── */}
        <section>
          <Card className="glass-panel overflow-hidden">
            <CardContent className="p-0">
              {/* Tab header */}
              <div className="flex items-center justify-between gap-3 border-b border-white/60 px-5 py-4">
                <div className="flex items-center gap-4">
                  <p className="text-base font-semibold text-slate-900">Progress Breakdown</p>
                  <div className="flex gap-1 rounded-[1.2rem] border border-white/60 bg-white/30 p-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab("state")}
                      className={cn(
                        "rounded-[0.9rem] px-4 py-1.5 text-sm font-semibold transition-all",
                        activeTab === "state"
                          ? "bg-white shadow-sm text-slate-900"
                          : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      By State
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("ea")}
                      className={cn(
                        "rounded-[0.9rem] px-4 py-1.5 text-sm font-semibold transition-all",
                        activeTab === "ea"
                          ? "bg-white shadow-sm text-slate-900"
                          : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      By Ward
                    </button>
                  </div>
                  <label className="relative min-w-[260px] max-w-[360px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={progressSearch}
                      onChange={(event) => setProgressSearch(event.target.value)}
                      placeholder="Search by State, Ward, or Ward ID"
                      className="w-full rounded-[1rem] border border-white/70 bg-white/65 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
                    />
                  </label>
                </div>
                {canExportTables ? (
                  <button
                    type="button"
                    onClick={() => activeTab === "state" ? downloadStateCsv(filteredStateRows) : downloadEaCsv(filteredEaRows)}
                    className="flex items-center gap-1.5 rounded-[1rem] border border-white/70 bg-white/44 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-all hover:bg-white/70"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download CSV
                  </button>
                ) : null}
              </div>

              {summaryQuery.isLoading ? (
                <div className="p-6 text-sm text-slate-500">Loading summary data...</div>
              ) : summaryQuery.isError ? (
                <div className="p-6">
                  <EmptyState title="Summary unavailable" message="Could not load state/Ward summary." />
                </div>
              ) : activeTab === "state" ? (
                filteredStateRows.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No data" message="No case data available yet." />
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: "calc(12 * 3.25rem + 2.5rem)" }}>
                    <table className="w-full caption-bottom border-collapse border border-slate-300/90 text-sm">
                      <TableHeader className="bg-white shadow-[0_2px_4px_rgba(0,0,0,0.08)] [&_tr]:border-b">
                        <TableRow className="hover:bg-transparent">
                          <TableHead rowSpan={2} className="sticky top-0 z-40 min-w-[160px] cursor-pointer border border-slate-300/90 bg-white text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("state_name")}>State {stateSortKey === "state_name" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("target_cases")}>Target Cases {stateSortKey === "target_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead colSpan={3} className="sticky top-0 z-40 border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cases</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("achieved_pct")}>% of Target {stateSortKey === "achieved_pct" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("approved_cases")}>Approved {stateSortKey === "approved_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("rejected_cases")}>Rejected {stateSortKey === "rejected_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("pending_cases")}>Pending Approval {stateSortKey === "pending_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("accompaniment_pct")}>Accompaniment Level {stateSortKey === "accompaniment_pct" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                        </TableRow>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="sticky top-12 z-30 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("total_cases")}>Total {stateSortKey === "total_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead className="sticky top-12 z-30 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("main_achieved_cases")}>Main {stateSortKey === "main_achieved_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead className="sticky top-12 z-30 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleStateSort("replacement_achieved_cases")}>Repl {stateSortKey === "replacement_achieved_cases" ? (stateSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedStateRows.map((row) => (
                          <TableRow key={row.state_name} className="border-white/40 hover:bg-white/30">
                            <TableCell className="border border-slate-300/90 font-semibold text-slate-900">{row.state_name}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums text-slate-600">{row.target_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-slate-900">{row.total_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums text-slate-800">{(row.main_achieved_cases ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums text-slate-800">{(row.replacement_achieved_cases ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-slate-800">{row.achieved_pct.toFixed(1)}%</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-emerald-700">{row.approved_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-rose-700">{row.rejected_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-amber-700">{row.pending_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90">
                              <AccompanimentCell pct={row.accompaniment_pct} />
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-slate-100/90 hover:bg-slate-100/90">
                          <TableCell className="border border-slate-300/90 font-bold text-slate-900">Grand Total</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-600">{stateTotals.target_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{stateTotals.total_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{stateTotals.main_achieved_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{stateTotals.replacement_achieved_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{stateTotals.achieved_pct.toFixed(1)}%</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-emerald-700">{stateTotals.approved_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-rose-700">{stateTotals.rejected_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-amber-700">{stateTotals.pending_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90">
                            <AccompanimentCell pct={stateTotals.accompaniment_pct} />
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </table>
                  </div>
                )
              ) : (
                filteredEaRows.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No data" message="No Ward data available yet." />
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: "calc(21 * 3.25rem + 2.5rem)" }}>
                    <table className="w-full caption-bottom border-collapse border border-slate-300/90 text-sm">
                      <TableHeader className="bg-white shadow-[0_2px_4px_rgba(0,0,0,0.08)] [&_tr]:border-b">
                        <TableRow className="hover:bg-transparent">
                          <TableHead rowSpan={2} className="sticky top-0 z-40 min-w-[180px] cursor-pointer border border-slate-300/90 bg-white text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("ea_name")}>Ward {eaSortKey === "ea_name" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 min-w-[110px] cursor-pointer border border-slate-300/90 bg-white text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("ea_id")}>Ward ID {eaSortKey === "ea_id" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 min-w-[130px] cursor-pointer border border-slate-300/90 bg-white text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("state_name")}>State {eaSortKey === "state_name" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("target_cases")}>Target Cases {eaSortKey === "target_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead colSpan={3} className="sticky top-0 z-40 border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cases</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("achieved_pct")}>% of Target {eaSortKey === "achieved_pct" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("approved_cases")}>Approved {eaSortKey === "approved_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("rejected_cases")}>Rejected {eaSortKey === "rejected_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("pending_cases")}>Pending Approval{eaSortKey === "pending_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead rowSpan={2} className="sticky top-0 z-40 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("accompaniment_pct")}>Accompaniment Level {eaSortKey === "accompaniment_pct" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                        </TableRow>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="sticky top-12 z-30 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("total_cases")}>Total {eaSortKey === "total_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead className="sticky top-12 z-30 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("main_achieved_cases")}>Main {eaSortKey === "main_achieved_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                          <TableHead className="sticky top-12 z-30 cursor-pointer border border-slate-300/90 bg-white text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" onClick={() => handleEaSort("replacement_achieved_cases")}>Repl {eaSortKey === "replacement_achieved_cases" ? (eaSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedEaRows.map((row, i) => (
                          <TableRow key={`${row.ea_id ?? ""}${i}`} className="border-white/40 hover:bg-white/30">
                            <TableCell className="border border-slate-300/90 font-semibold text-slate-900">
                              {row.ea_id ? (
                                <button
                                  type="button"
                                  onClick={() => void openEaModal(row)}
                                  title="Open EA map, polygon, GPS points, and EA-wide review actions"
                                  className="text-left underline decoration-slate-300 underline-offset-4 transition hover:text-primary hover:decoration-primary"
                                >
                                  {row.ea_name ?? row.ea_id ?? "Unknown"}
                                </button>
                              ) : (
                                row.ea_name ?? row.ea_id ?? "Unknown"
                              )}
                            </TableCell>
                            <TableCell className="border border-slate-300/90 font-mono text-xs text-slate-600">
                              {row.ea_id ? (
                                <button
                                  type="button"
                                  onClick={() => void openEaModal(row)}
                                  title="Open EA map, polygon, GPS points, and EA-wide review actions"
                                  className="underline decoration-slate-300 underline-offset-4 transition hover:text-primary hover:decoration-primary"
                                >
                                  {row.ea_id}
                                </button>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="border border-slate-300/90 text-slate-700">{row.state_name}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums text-slate-600">{row.target_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-slate-900">{row.total_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums text-slate-800">{(row.main_achieved_cases ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums text-slate-800">{(row.replacement_achieved_cases ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-slate-800">{row.achieved_pct.toFixed(1)}%</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-emerald-700">{row.approved_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-rose-700">{row.rejected_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90 text-center tabular-nums font-semibold text-amber-700">{row.pending_cases.toLocaleString()}</TableCell>
                            <TableCell className="border border-slate-300/90">
                              <AccompanimentCell pct={row.accompaniment_pct} />
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-slate-100/90 hover:bg-slate-100/90">
                          <TableCell className="border border-slate-300/90 font-bold text-slate-900">Grand Total</TableCell>
                          <TableCell className="border border-slate-300/90" />
                          <TableCell className="border border-slate-300/90" />
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-600">{eaTotals.target_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{eaTotals.total_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{eaTotals.main_achieved_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{eaTotals.replacement_achieved_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-slate-900">{eaTotals.achieved_pct.toFixed(1)}%</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-emerald-700">{eaTotals.approved_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-rose-700">{eaTotals.rejected_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90 text-center font-bold tabular-nums text-amber-700">{eaTotals.pending_cases.toLocaleString()}</TableCell>
                          <TableCell className="border border-slate-300/90">
                            <AccompanimentCell pct={eaTotals.accompaniment_pct} />
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </table>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <Dialog open={eaConfirmStatus !== null} onOpenChange={(open) => !open && setEaConfirmStatus(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Ward status update</DialogTitle>
            <DialogDescription>
              {eaConfirmStatus === "approved"
                ? `You are about to approve all Main Survey cases in Ward ${eaModalData?.eaId ?? selectedEaRow?.ea_id ?? ""}.`
                : eaConfirmStatus === "rejected"
                  ? `You are about to reject all Main Survey cases in Ward ${eaModalData?.eaId ?? selectedEaRow?.ea_id ?? ""}.`
                  : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEaConfirmStatus(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const status = eaConfirmStatus;
                setEaConfirmStatus(null);
                if (status) {
                  void runEaStatusAction(status);
                }
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {eaModalOpen ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={() => setEaModalOpen(false)}
        >
          <div
            className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MapPinned className="h-5 w-5 text-primary" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Ward snapshot</p>
                </div>
                <h3 className="mt-1 truncate text-lg font-semibold text-slate-900">
                  {eaModalData?.eaName ?? selectedEaRow?.ea_name ?? selectedEaRow?.ea_id ?? "Ward overview"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {eaModalData?.eaId ?? selectedEaRow?.ea_id ?? "Unknown Ward"}
                  {eaModalData?.stateName ? ` • ${eaModalData?.stateName}` : selectedEaRow?.state_name ? ` • ${selectedEaRow?.state_name}` : ""}
                  {eaModalData?.lgaName ? ` • ${eaModalData?.lgaName}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEaModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/70 bg-white/50 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-700"
                title="Close Ward snapshot"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 border-b border-slate-100 px-6 py-4 md:grid-cols-4">
              <StatTile label="Total cases" value={eaModalData?.totalCases ?? selectedEaRow?.total_cases ?? 0} accent="sky" />
              <StatTile label="Approved" value={eaModalData?.approvedCases ?? selectedEaRow?.approved_cases ?? 0} accent="emerald" />
              <StatTile label="Rejected" value={eaModalData?.rejectedCases ?? selectedEaRow?.rejected_cases ?? 0} accent="amber" />
              <StatTile label="Pending" value={eaModalData?.pendingCases ?? selectedEaRow?.pending_cases ?? 0} accent="violet" />
            </div>

            <div className="h-[62vh] w-full">
              {eaModalLoading ? (
                <div className="flex h-full items-center justify-center gap-3 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading Ward map...
                </div>
              ) : eaModalError ? (
                <div className="flex h-full items-center justify-center p-6">
                  <EmptyState title="Ward map unavailable" message={eaModalError ?? "Ward map unavailable."} />
                </div>
              ) : (
                <MapContainer center={NIGERIA_CENTER} zoom={6} scrollWheelZoom zoomControl attributionControl={false} className="h-full w-full">
                  <SnapshotFitController feature={(eaModalData?.eaFeature as Record<string, unknown> | null | undefined) ?? null} />
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                  {eaModalData?.eaFeature ? (
                    <GeoJSON
                      data={eaModalData?.eaFeature as unknown as GeoJsonObject}
                      style={{ color: "#3b82f6", weight: 2.8, fillColor: "#93c5fd", fillOpacity: 0.18 }}
                    />
                  ) : null}
                  {displayGpsPoints.map((point) => {
                    const tooltipDirection = tooltipDirectionForDuplicate(point);
                    return (
                      <Marker
                        key={point.submission_key}
                        position={[point.displayLat, point.displayLng]}
                        icon={mainSurveySquareIcon}
                        eventHandlers={{
                          click: (event) => {
                            if (point.duplicateCount > 1) {
                              setActiveGpsTooltipGroup((current) => current === point.groupKey ? null : point.groupKey);
                            } else {
                              event.target.openTooltip();
                            }
                          },
                        }}
                      >
                        <Tooltip
                          direction={tooltipDirection}
                          offset={tooltipDirection === "left" || tooltipDirection === "right" ? [0, 0] : [0, -6]}
                          opacity={0.96}
                          permanent={point.duplicateCount > 1 && activeGpsTooltipGroup === point.groupKey}
                          sticky={point.duplicateCount <= 1}
                        >
                          <div className="space-y-1 text-xs">
                            <p className="font-semibold text-slate-900">{point.case_id ?? point.submission_key}</p>
                            <p className="text-slate-600">{formatToken(point.approval_stage ?? "pending_review")}</p>
                            <p className="text-slate-500">{point.submission_key}</p>
                          </div>
                        </Tooltip>
                      </Marker>
                    );
                  })}
                  {visibleListingSnapshotPoints.map((point, index) => (
                    <ListingSnapshotPointMarker key={`main-overview-listing-${index}`} point={point} index={index} />
                  ))}
                </MapContainer>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
              <label className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-600">
                <Checkbox
                  checked={showNonResidential}
                  onCheckedChange={(checked) => setShowNonResidential(checked === true)}
                />
                Non-residential
              </label>
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/70 bg-white/60 px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-500">Sample status</span>
                {SAMPLE_STATUS_OPTIONS.map((option) => (
                  <label key={option} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Checkbox
                      checked={selectedSampleStatuses.includes(option)}
                      onCheckedChange={() => toggleSampleStatusFilter(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-[2px] border-2 border-orange-700 bg-orange-500" />
                Main survey GPS (orange square)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-700 bg-blue-500" />
                Listing household GPS
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base leading-none text-yellow-400 [text-shadow:0_0_1px_#854d0e]">★</span>
                Listing sampled household
              </div>
              <span className="ml-auto">
                {displayGpsPoints.length.toLocaleString()} main GPS · {visibleListingSnapshotPoints.length.toLocaleString()} listing GPS plotted
              </span>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Ward review note</label>
                <input
                  value={eaActionNote}
                  onChange={(event) => setEaActionNote(event.target.value)}
                  placeholder="Optional note for the Ward-wide decision"
                  className="mt-2 h-11 w-full rounded-2xl border border-white/70 bg-white/50 px-4 text-sm text-slate-900 outline-none transition focus:border-primary/40"
                />
                {eaActionMessage ? <p className="mt-2 text-xs text-slate-600">{eaActionMessage}</p> : null}
              </div>
              {canReviewEa ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => setEaConfirmStatus("approved")}
                    disabled={eaModalLoading || eaActionLoading !== null || !eaModalData}
                    className="h-11 rounded-2xl px-4 text-sm"
                    title="Approve every main survey case currently tied to this Ward"
                  >
                    {eaActionLoading === "approved" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                    Approve Ward
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEaConfirmStatus("rejected")}
                    disabled={eaModalLoading || eaActionLoading !== null || !eaModalData}
                    className="h-11 rounded-2xl border-rose-500/25 bg-rose-500/10 px-4 text-sm text-rose-700 hover:bg-rose-500/20"
                    title="Reject every main survey case currently tied to this Ward"
                  >
                    {eaActionLoading === "rejected" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                    Reject Ward
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Open map and point tooltips are available. Ward-wide review actions are enabled for the current broad-access phase.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </PlatformPage>
  );
}
