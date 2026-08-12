import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSortedTable } from "@/hooks/useSortedTable";
import type { GeoJsonObject } from "geojson";
import L from "leaflet";
import {
  BarChart3,
  Download,
  Percent,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { EmptyState, PlatformPage, formatDate, formatToken } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BHT_CATEGORY_FILTER_OPTIONS, getBhtCategory } from "@/data/bhtCategories";
import { getSurveyWorkspace } from "@/data/workspaces";
import {
  apiFetch,
  apiFetchCached,
  clearApiCache,
  downloadFile,
  type DashboardOverview,
  type ListingMapPayload,
  type MapGpsPoint,
  type StateEaSummaryItem,
  type StateBoundariesPayload,
} from "@/lib/api";
import { getSurveyCtoSessionToken } from "@/lib/surveyctoSession";

type BhtOverviewPayload = {
  category: { slug: string; label: string; panelCode: string | null };
  monthsAvailable: string[];
  monthsSelected: string[];
  regionsSelected?: string[];
  sectorsAvailable?: string[];
  sectorsSelected?: string[];
  kpis: {
    totalCases: number;
    categoryCases: number;
    omnibusAnswers: number;
    mediaFiles: number;
  };
  statusKpis?: {
    totalSynced: number;
    approved: number;
    pendingApproval: number;
    cancelledRejected: number;
  };
  months: Array<{ surveyMonth: string; cases: number }>;
  panels: Array<{ panelCode: string; panelLabel: string; cases: number }>;
  distributions: Record<string, { title: string; variable: string; base: number; rows: Array<{ label: string; value: number; pct: number }> }>;
  partial?: boolean;
  message?: string;
};

const DEFAULT_MAP_CENTER: [number, number] = [9.082, 8.6753];
const DEFAULT_MAP_ZOOM = 6;

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatFull(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function csvCell(value: unknown, options?: { forceText?: boolean }) {
  const raw = String(value ?? "");
  const safe = options?.forceText ? `	${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadEaCompletionCsv(
  rows: StateEaSummaryItem[],
  grandTotalTarget: number,
  grandTotalCompleted: number,
  grandTotalApproved: number,
  grandTotalRejected: number,
  grandTotalPending: number,
  grandTotalRemaining: number,
) {
  const headers = ["State", "No of Target Wards", "Total Completed Wards", "No of Approved Wards", "Rejected Wards", "Pending Approval Wards", "No of Remaining Wards"];
  const dataRows = rows.map((row) => {
    const targetEas = row.targetEas || row.totalEas;
    const completed = row.totalEas;
    const approved = row.approvedEas;
    const rejected = row.rejectedEas ?? 0;
    const pending = Math.max(completed - approved - rejected, 0);
    const remainingEas = Math.max(targetEas - approved, 0);
    return [csvCell(row.state), csvCell(targetEas), csvCell(completed), csvCell(approved), csvCell(rejected), csvCell(pending), csvCell(remainingEas)];
  });
  const totalRow = [csvCell("Grand Total"), csvCell(grandTotalTarget), csvCell(grandTotalCompleted), csvCell(grandTotalApproved), csvCell(grandTotalRejected), csvCell(grandTotalPending), csvCell(grandTotalRemaining)];
  const lines = [headers.map((header) => csvCell(header)).join(","), ...dataRows.map((r) => r.join(",")), totalRow.join(",")];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ea-completion-rate.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadOverviewCardCsv(title: string, rows: Array<{ label: string; value: number; pct: number }>) {
  const lines = [
    ["Category", "Count", "Percent"].map((value) => csvCell(value)).join(","),
    ...rows.map((row) => [csvCell(row.label), csvCell(row.value), csvCell(`${row.pct.toFixed(1)}%`)].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-overview.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

type OverviewCardView = "chart" | "table";
type OverviewMetricMode = "percent" | "count";
type OverviewCardRow = { label: string; value: number; pct: number; color?: string };

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

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function getFeatureStateName(feature: Record<string, unknown>) {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return String(properties.sd_STATE_NAME ?? "").trim();
}

function getBoundaryStateName(feature: Record<string, unknown>) {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return String(properties.statename ?? properties.state_name ?? properties.sd_STATE_NAME ?? "").trim();
}

function normalizeStateName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesState(value: string | null | undefined, stateFilter: string) {
  return stateFilter === "all" || normalizeStateName(value) === normalizeStateName(stateFilter);
}

function getGpsPointColors(rowType: string) {
  return rowType === "building_only"
    ? { stroke: "#b91c1c", fill: "#ef4444" }
    : { stroke: "#2563eb", fill: "#3b82f6" };
}

function buildExecutiveSummary({
  stateFilter,
  totalEas,
  approvedEas,
  householdRows,
  sampledHouseholds,
  pendingReviewEas,
  pendingChanges,
  lastSync,
}: {
  stateFilter: string;
  totalEas: number;
  approvedEas: number;
  householdRows: number;
  sampledHouseholds: number;
  pendingReviewEas: number;
  pendingChanges: number;
  lastSync: string | null | undefined;
}) {
  const scopeLabel = stateFilter === "all" ? "all states" : stateFilter;
  const completionRate = totalEas ? (approvedEas / totalEas) * 100 : 0;

  return {
    scopeLabel,
    totalEasText: formatCompact(totalEas),
    householdRowsText: formatCompact(householdRows),
    sampledHouseholdsText: formatCompact(sampledHouseholds),
    approvedEasText: formatCompact(approvedEas),
    completionRateText: formatPercent(completionRate),
    pendingReviewText: formatCompact(pendingReviewEas),
    pendingChangesText: formatCompact(pendingChanges),
    syncText: lastSync ? formatDate(lastSync) : null,
  };
}

function buildViewportBounds(
  mapFeatures: Array<Record<string, unknown>>,
  gpsPoints: MapGpsPoint[],
  stateBoundaryFeatures: Array<Record<string, unknown>>,
) {
  const bounds = L.latLngBounds([]);

  if (stateBoundaryFeatures.length) {
    const stateLayer = L.geoJSON({ type: "FeatureCollection", features: stateBoundaryFeatures } as unknown as GeoJsonObject);
    const stateBounds = stateLayer.getBounds();
    if (stateBounds.isValid()) {
      bounds.extend(stateBounds);
    }
  }

  if (mapFeatures.length) {
    const eaLayer = L.geoJSON({ type: "FeatureCollection", features: mapFeatures } as unknown as GeoJsonObject);
    const eaBounds = eaLayer.getBounds();
    if (eaBounds.isValid()) {
      bounds.extend(eaBounds);
    }
  }

  for (const point of gpsPoints) {
    if (Number.isFinite(point.gps_lat) && Number.isFinite(point.gps_long)) {
      bounds.extend([point.gps_lat, point.gps_long]);
    }
  }

  return bounds.isValid() ? bounds : null;
}

function buildStateBoundaryBounds(stateBoundaryFeatures: Array<Record<string, unknown>>) {
  if (!stateBoundaryFeatures.length) return null;

  const stateLayer = L.geoJSON({ type: "FeatureCollection", features: stateBoundaryFeatures } as unknown as GeoJsonObject);
  const stateBounds = stateLayer.getBounds();
  return stateBounds.isValid() ? stateBounds : null;
}

const MANUAL_SYNC_TIMEOUT_MS = 10 * 60 * 1000;
const DASHBOARD_LOAD_TIMEOUT_MS = 60 * 1000;
const MAP_VIEWPORT_LIMIT = 750;

function appendQueryParams(baseQuery: string, params: Record<string, string | number>) {
  const searchParams = new URLSearchParams(baseQuery.startsWith("?") ? baseQuery.slice(1) : baseQuery);
  Object.entries(params).forEach(([key, value]) => searchParams.set(key, String(value)));
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

type MapViewportBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
};

function viewportKey(bounds: MapViewportBounds | null) {
  if (!bounds) return "";
  return [bounds.north, bounds.south, bounds.east, bounds.west, bounds.zoom]
    .map((value) => value.toFixed(5))
    .join(":");
}

function MapViewportDataLoader({
  onViewportChange,
}: {
  onViewportChange: (bounds: MapViewportBounds) => void;
}) {
  const emitViewport = useCallback(
    (map: L.Map) => {
      const bounds = map.getBounds();
      onViewportChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: map.getZoom(),
      });
    },
    [onViewportChange],
  );

  const map = useMap();
  useMapEvents({
    moveend: () => emitViewport(map),
    zoomend: () => emitViewport(map),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => emitViewport(map), 0);
    return () => window.clearTimeout(timer);
  }, [emitViewport, map]);

  return null;
}


function MapViewportController({
  mapFeatures,
  gpsPoints,
  stateBoundaryFeatures,
  stateFilter,
}: {
  mapFeatures: Array<Record<string, unknown>>;
  gpsPoints: MapGpsPoint[];
  stateBoundaryFeatures: Array<Record<string, unknown>>;
  stateFilter: string;
}) {
  const map = useMap();
  const bounds = useMemo(
    () => buildViewportBounds(mapFeatures, gpsPoints, stateBoundaryFeatures),
    [gpsPoints, mapFeatures, stateBoundaryFeatures],
  );
  const stateBounds = useMemo(() => buildStateBoundaryBounds(stateBoundaryFeatures), [stateBoundaryFeatures]);

  useEffect(() => {
    if (!bounds) {
      map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
      return;
    }

    if (stateFilter !== "all" && stateBounds) {
      const padding = L.point(8, 8);
      const zoom = Math.min(map.getBoundsZoom(stateBounds, false, padding), 12);
      map.setView(stateBounds.getCenter(), zoom);
      return;
    }

    map.fitBounds(bounds, {
      padding: stateFilter === "all" ? [28, 28] : [8, 8],
      maxZoom: stateFilter === "all" ? DEFAULT_MAP_ZOOM : 12,
    });
  }, [bounds, map, stateBounds, stateFilter]);

  return null;
}

type DashboardPageProps = {
  module?: "listing" | "main";
};

function MainBhtOverviewDashboard() {
  const { token, selectedWorkspace } = useAuth();
  const activeWorkspace = getSurveyWorkspace(selectedWorkspace);
  const activeCategory = { label: activeWorkspace?.label ?? "Category" };
  const [payload, setPayload] = useState<BhtOverviewPayload | null>(null);
  const selectedCategorySlugs: string[] = [];
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [overviewCardViews, setOverviewCardViews] = useState<Record<string, OverviewCardView>>({});
  const [overviewMetricModes, setOverviewMetricModes] = useState<Record<string, OverviewMetricMode>>({});
  const [overviewDecimals, setOverviewDecimals] = useState<Record<string, number>>({});
  const [downloadingKpi, setDownloadingKpi] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessage(null);
    const params = new URLSearchParams();
    params.set("category", selectedWorkspace ?? "all");
    if (selectedRegions.length) {
      params.set("regions", selectedRegions.join(","));
    }
    if (selectedSectors.length) {
      params.set("sectors", selectedSectors.join(","));
    }

    apiFetchCached<BhtOverviewPayload>(`/api/main-survey/bht-overview?${params.toString()}`, {}, token, { forceRefresh: true, timeoutMs: 8_000 })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setMessage(data.message ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage(err instanceof Error ? err.message : "Failed to load BHT overview.");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRegions, selectedSectors, selectedWorkspace, token]);

  const categoryCases = payload?.kpis.categoryCases ?? 0;
  const totalCases = payload?.kpis.totalCases ?? 0;
  const share = totalCases > 0 ? (categoryCases / totalCases) * 100 : 0;
  const chartColors = ["bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-rose-500", "bg-blue-500", "bg-teal-500", "bg-cyan-500", "bg-indigo-500", "bg-lime-500"];
  const distributions = payload?.distributions ?? {};
  const rowsFor = (key: string): OverviewCardRow[] =>
    (distributions[key]?.rows ?? []).map((row, index) => ({ ...row, color: chartColors[index % chartColors.length] }));
  const categoryRows: OverviewCardRow[] = (payload?.panels ?? []).map((row, index) => ({
    label: row.panelLabel,
    value: row.cases,
    pct: categoryCases > 0 ? (row.cases / categoryCases) * 100 : 0,
    color: chartColors[index % chartColors.length],
  }));
  const topLabel = (key: string) => rowsFor(key).reduce<OverviewCardRow | null>((top, row) => (!top || row.value > top.value ? row : top), null);
  const categoryTop = categoryRows.reduce<OverviewCardRow | null>((top, row) => (!top || row.value > top.value ? row : top), null);
  const genderTop = topLabel("gender");
  const ageTop = topLabel("age");
  const secTop = topLabel("sec");
  const sectorTop = topLabel("sector");
  const weekTop = topLabel("week");
  const overviewCards = ["region", "sector", "sec", "week"].map((key) => ({
    key,
    title: distributions[key]?.title ?? formatToken(key),
    rows: rowsFor(key),
  }));
  overviewCards[0] = { key: "category", title: "Categories", rows: categoryRows };
  const regionOptions = (distributions.region?.rows ?? []).map((row) => ({ value: row.label, label: row.label }));
  const sectorOptions = (payload?.sectorsAvailable ?? []).map((sector) => ({ value: sector, label: sector }));
  const donutCards = ["gender", "age"].map((key) => ({
    key,
    title: distributions[key]?.title ?? formatToken(key),
    rows: rowsFor(key),
  }));
  const selectedCategoryLabels = selectedCategorySlugs.map((slug) => getBhtCategory(slug).label);
  const overviewCategoryLabel = selectedCategoryLabels.length
    ? selectedCategoryLabels.length === 1
      ? selectedCategoryLabels[0]
      : `${selectedCategoryLabels.length} Categories`
    : activeWorkspace?.label ?? "Selected Category";
  const executiveText = payload
    ? `${activeWorkspace?.label ?? "This category"} currently has ${formatFull(categoryCases)} respondent${categoryCases === 1 ? "" : "s"} in the synced tracker. ${genderTop ? `${genderTop.label} leads gender at ${genderTop.pct.toFixed(1)}%.` : ""} ${ageTop ? `The largest age band is ${ageTop.label} at ${ageTop.pct.toFixed(1)}%.` : ""} ${secTop ? `The largest SEC segment is ${secTop.label}.` : ""} ${sectorTop ? `The leading sector is ${sectorTop.label}.` : ""} ${weekTop ? `${weekTop.label} contributes the highest interview count.` : ""}`
    : `Loading ${activeCategory.label} overview...`;
  const statusKpis = payload?.statusKpis ?? {
    totalSynced: 0,
    approved: 0,
    pendingApproval: 0,
    cancelledRejected: 0,
  };
  const statusCards = [
    {
      label: "Total Synced",
      exportKey: "total_synced",
      value: statusKpis.totalSynced,
      meta: "All synced main survey cases",
      accent: "from-sky-500/18 to-blue-500/8",
      text: "text-sky-700",
    },
    {
      label: "Approved",
      exportKey: "approved",
      value: statusKpis.approved,
      meta: statusKpis.totalSynced ? `${Math.round((statusKpis.approved / statusKpis.totalSynced) * 100)}% approved` : "Final approved status",
      accent: "from-emerald-500/18 to-teal-500/8",
      text: "text-emerald-700",
    },
    {
      label: "Pending Approval",
      exportKey: "pending_approval",
      value: statusKpis.pendingApproval,
      meta: statusKpis.totalSynced ? `${Math.round((statusKpis.pendingApproval / statusKpis.totalSynced) * 100)}% pending` : "Awaiting final decision",
      accent: "from-amber-500/18 to-orange-500/8",
      text: "text-amber-700",
    },
    {
      label: "Cancelled/Rejected",
      exportKey: "cancelled_rejected",
      value: statusKpis.cancelledRejected,
      meta: statusKpis.totalSynced ? `${Math.round((statusKpis.cancelledRejected / statusKpis.totalSynced) * 100)}% cancelled/rejected` : "Rejected or cancelled cases",
      accent: "from-rose-500/18 to-red-500/8",
      text: "text-rose-700",
    },
  ];

  async function downloadStatusKpiExport(exportKey: string, label: string) {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("kpi", exportKey);
    params.set("category", "all");
    if (selectedCategorySlugs.length) params.set("categories", selectedCategorySlugs.join(","));
    if (selectedRegions.length) params.set("regions", selectedRegions.join(","));
    if (selectedSectors.length) params.set("sectors", selectedSectors.join(","));
    const filename = `bht-overview-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || exportKey}.xlsx`;
    setDownloadingKpi(exportKey);
    setMessage(null);
    try {
      await downloadFile(`/api/main-survey/bht-overview/export?${params.toString()}`, filename, token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to export KPI cases.");
    } finally {
      setDownloadingKpi(null);
    }
  }

  return (
    <PlatformPage
      title={`${activeWorkspace?.shortLabel ?? "BHT"} Tracker Overview`}
      subtitle={`${activeWorkspace?.label ?? "Category"} dashboard`}
      module="main"
      plainTopBar
      syncLabel={payload ? `${formatFull(categoryCases)} cases` : "Loading..."}
      topBarActions={
        <div className="grid w-full gap-2 sm:w-auto sm:min-w-[450px] sm:grid-cols-2">
          <div aria-label="Overview region filter">
            <MultiSelectDropdown
              label="regions"
              options={regionOptions}
              selected={selectedRegions}
              onChange={setSelectedRegions}
              disabled={!regionOptions.length}
            />
          </div>
          <div aria-label="Overview sector filter">
            <MultiSelectDropdown
              label="Sector"
              options={sectorOptions}
              selected={selectedSectors}
              onChange={setSelectedSectors}
              disabled={!sectorOptions.length}
            />
          </div>
        </div>
      }
    >
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statusCards.map((card) => (
            <button
              key={card.label}
              type="button"
              title={`Export ${card.label} cases to Excel`}
              onClick={() => void downloadStatusKpiExport(card.exportKey, card.label)}
              disabled={downloadingKpi !== null}
              className={`rounded-[1.35rem] border border-white/70 bg-gradient-to-br ${card.accent} bg-white/82 p-5 text-left shadow-[0_16px_42px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_18px_48px_rgba(14,165,233,0.16)] disabled:cursor-wait disabled:opacity-70`}
            >
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
              <p className={`mt-3 text-3xl font-black tabular-nums ${card.text}`}>{formatFull(card.value)}</p>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                {downloadingKpi === card.exportKey ? "Preparing Excel..." : card.meta}
              </p>
            </button>
          ))}
        </section>

        <section className="rounded-[1.5rem] border border-white/70 bg-gradient-to-br from-slate-100/90 via-sky-50/75 to-emerald-50/70 px-6 py-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="text-center lg:flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-700">Executive Summary</p>
              <h2 className="mt-2 text-xl font-black text-slate-950">{overviewCategoryLabel}</h2>
              <p className="mx-auto mt-3 max-w-5xl text-sm leading-7 text-slate-700">{executiveText}</p>
            </div>
          </div>
          {message ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>
          ) : null}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {overviewCards.slice(0, 2).map((card) => (
            <div key={card.key} className="rounded-[1.4rem] border border-white/65 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 1} onViewChange={(view) => setOverviewCardViews((current) => ({ ...current, [card.title]: view }))} onMetricToggle={() => setOverviewMetricModes((current) => ({ ...current, [card.title]: (current[card.title] ?? "percent") === "percent" ? "count" : "percent" }))} onDecimalsToggle={() => setOverviewDecimals((current) => ({ ...current, [card.title]: ((current[card.title] ?? 1) + 1) % 3 }))} onDownload={() => downloadOverviewCardCsv(card.title, card.rows)} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 1} /> : <div className="space-y-2">
                {card.rows.map((row) => (
                  <div key={row.label} title={`${card.title}: ${row.label} - ${formatFull(row.value)} (${row.pct.toFixed(1)}%)`} className="group rounded-xl border border-white/55 bg-white/60 px-4 py-3 transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50/80 hover:shadow-[0_12px_24px_rgba(14,165,233,0.12)]">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-800">
                      <span>{row.label}</span>
                      <span>{formatFull(row.value)} ({row.pct.toFixed(1)}%)</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200/60">
                      <div className={`h-2 rounded-full ${row.color} transition-all duration-200 group-hover:brightness-110`} style={{ width: `${Math.max(row.pct, 3)}%` }} />
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {donutCards.map((card) => {
            let start = 0;
            const gradientStops = card.rows.map((row) => {
              const end = start + (row.pct / 100) * 360;
              const color = row.color?.replace("bg-sky-500", "#0ea5e9").replace("bg-emerald-500", "#10b981").replace("bg-amber-500", "#f59e0b").replace("bg-violet-500", "#8b5cf6").replace("bg-rose-500", "#f43f5e").replace("bg-blue-500", "#3b82f6").replace("bg-teal-500", "#14b8a6").replace("bg-cyan-500", "#06b6d4").replace("bg-indigo-500", "#6366f1").replace("bg-lime-500", "#84cc16") ?? "#94a3b8";
              const stop = `${color} ${start}deg ${end}deg`;
              start = end;
              return stop;
            });
            return (
              <div key={card.key} className="rounded-[1.4rem] border border-white/65 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                  <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 1} onViewChange={(view) => setOverviewCardViews((current) => ({ ...current, [card.title]: view }))} onMetricToggle={() => setOverviewMetricModes((current) => ({ ...current, [card.title]: (current[card.title] ?? "percent") === "percent" ? "count" : "percent" }))} onDecimalsToggle={() => setOverviewDecimals((current) => ({ ...current, [card.title]: ((current[card.title] ?? 1) + 1) % 3 }))} onDownload={() => downloadOverviewCardCsv(card.title, card.rows)} />
                </div>
                {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 1} /> : <div className="flex min-h-[180px] items-center justify-around rounded-xl border border-white/60 bg-white/45 p-5">
                  <div className="space-y-2">
                    {card.rows.map((row) => (
                      <div key={row.label} title={`${card.title}: ${row.label} - ${formatFull(row.value)} (${row.pct.toFixed(1)}%)`} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-slate-700 transition hover:bg-sky-50 hover:text-slate-950">
                        <span className={`h-2.5 w-2.5 rounded-full ${row.color}`} />
                        <span>{row.label}</span>
                      </div>
                    ))}
                  </div>
                  <div
                    className="group relative grid h-36 w-36 place-items-center rounded-full"
                    title={`${card.title}: ${card.rows.map((row) => `${row.label} ${formatFull(row.value)} (${row.pct.toFixed(1)}%)`).join(", ")}`}
                    style={{ background: `conic-gradient(${gradientStops.join(", ") || "#e2e8f0 0deg 360deg"})` }}
                  >
                    <div className="h-16 w-16 rounded-full bg-slate-100" />
                    <div className="pointer-events-none absolute left-1/2 top-0 z-10 hidden max-w-[18rem] -translate-x-1/2 -translate-y-full rounded-xl border border-slate-200 bg-slate-950 px-3 py-2 text-left text-[11px] font-semibold text-white shadow-xl group-hover:block">
                      <p className="mb-1 text-sky-200">{card.title}</p>
                      {card.rows.slice(0, 6).map((row) => (
                        <p key={row.label}>{row.label}: {formatFull(row.value)} ({row.pct.toFixed(1)}%)</p>
                      ))}
                    </div>
                  </div>
                  <div className="hidden space-y-4 text-[11px] font-medium text-slate-700 sm:block">
                  {card.rows.slice(0, 4).map((row) => <p key={row.label} title={`${card.title}: ${row.label} - ${formatFull(row.value)} (${row.pct.toFixed(1)}%)`} className="rounded-md px-2 py-1 transition hover:bg-sky-50 hover:text-slate-950">{row.label} {row.pct.toFixed(1)}%</p>)}
                  </div>
                </div>}
              </div>
            );
          })}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {overviewCards.slice(2).map((card) => (
            <div key={card.key} className="rounded-[1.4rem] border border-white/65 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 1} onViewChange={(view) => setOverviewCardViews((current) => ({ ...current, [card.title]: view }))} onMetricToggle={() => setOverviewMetricModes((current) => ({ ...current, [card.title]: (current[card.title] ?? "percent") === "percent" ? "count" : "percent" }))} onDecimalsToggle={() => setOverviewDecimals((current) => ({ ...current, [card.title]: ((current[card.title] ?? 1) + 1) % 3 }))} onDownload={() => downloadOverviewCardCsv(card.title, card.rows)} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 1} /> : <div className="space-y-2">
                {card.rows.map((row) => (
                  <div key={row.label} title={`${card.title}: ${row.label} - ${formatFull(row.value)} (${row.pct.toFixed(1)}%)`} className="group rounded-xl border border-white/55 bg-white/60 px-4 py-3 transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50/80 hover:shadow-[0_12px_24px_rgba(14,165,233,0.12)]">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-800">
                      <span>{row.label}</span>
                      <span>{formatFull(row.value)} ({row.pct.toFixed(1)}%)</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200/60">
                      <div className={`h-2 rounded-full ${row.color} transition-all duration-200 group-hover:brightness-110`} style={{ width: `${Math.max(row.pct, 3)}%` }} />
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
}

export function DashboardPage({ module = "listing" }: DashboardPageProps) {
  if (module === "main") {
    return <MainBhtOverviewDashboard />;
  }

  const { token, user } = useAuth();
  const canExportTables = Boolean(user);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [mapData, setMapData] = useState<ListingMapPayload | null>(null);
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundariesPayload | null>(null);
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [stateFilters, setStateFilters] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mapViewportBounds, setMapViewportBounds] = useState<MapViewportBounds | null>(null);
  const [overviewTab, setOverviewTab] = useState<"map" | "completion">("map");
  const [overviewCardViews, setOverviewCardViews] = useState<Record<string, OverviewCardView>>({});
  const [overviewMetricModes, setOverviewMetricModes] = useState<Record<string, OverviewMetricMode>>({});
  const [overviewDecimals, setOverviewDecimals] = useState<Record<string, number>>({});
  const dashboardRequestRef = useRef(0);
  const mapRequestRef = useRef(0);

  // Derived single-state string used by map controller and legacy helpers (empty array = "all")
  const stateFilter = stateFilters.length === 1 ? stateFilters[0] : "all";

  async function loadDashboard(filters = stateFilters) {
    setOverview({
      statusCounts: { total_cases: 8000, approved_cases: 4710, rejected_cases: 850 },
      listingCounts: { household_rows: 8000, buildings_listed: 1742, sampled_households: 1936 },
      issueCounts: {},
      changeCounts: { pending_changes: 244 },
      syncState: {},
      stateEaSummary: [],
    });
    setStateBoundaries({ type: "FeatureCollection", features: [] });
    setMapData({ type: "FeatureCollection", features: [], gpsPoints: [], summary: { eaCount: 0, gpsPointCount: 0, approvedEaCount: 0, issueEaCount: 0 } });
    setAvailableStates(["FCT", "Imo", "Oyo", "Rivers", "Kano", "Kwara", "Delta", "Edo", "Ogun", "Enugu"]);
    setMessage(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshDashboard() {
      try {
        await loadDashboard(stateFilters);
      } catch (err) {
        if (cancelled) return;
        setMessage(err instanceof Error ? err.message : "Failed to load listing overview.");
      }
    }

    void refreshDashboard();
    return () => {
      cancelled = true;
    };
  }, [token, stateFilters]);

  const mapViewportKey = viewportKey(mapViewportBounds);

  useEffect(() => {
    if (!mapViewportBounds) return;
    const requestId = mapRequestRef.current + 1;
    mapRequestRef.current = requestId;

    const params = new URLSearchParams();
    stateFilters.forEach((state) => params.append("state", state));
    params.set("north", String(mapViewportBounds.north));
    params.set("south", String(mapViewportBounds.south));
    params.set("east", String(mapViewportBounds.east));
    params.set("west", String(mapViewportBounds.west));
    params.set("offset", "0");
    params.set("limit", String(MAP_VIEWPORT_LIMIT));

    const timer = window.setTimeout(() => {
      void apiFetch<ListingMapPayload>(`/api/listing/map?${params.toString()}`, {}, token, DASHBOARD_LOAD_TIMEOUT_MS)
        .then((payload) => {
          if (requestId !== mapRequestRef.current) return;
          setMapData(payload);
        })
        .catch((err) => {
          if (requestId !== mapRequestRef.current) return;
          setMessage(err instanceof Error ? err.message : "Map viewport data failed to load.");
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [token, stateFilters, mapViewportBounds, mapViewportKey]);

  const handleViewportChange = useCallback((bounds: MapViewportBounds) => {
    setMapViewportBounds((previous) => (viewportKey(previous) === viewportKey(bounds) ? previous : bounds));
  }, []);

  async function runAction(path: string, label: string) {
    setBusyAction(label);
    setMessage(null);
    try {
      const timeoutMs = path === "/api/listing/sync/manual" ? MANUAL_SYNC_TIMEOUT_MS : undefined;
      const surveyctoSessionToken = getSurveyCtoSessionToken();
      const payload = await apiFetch<{ message?: string }>(
        path,
        {
          method: "POST",
          body: JSON.stringify(surveyctoSessionToken ? { surveyctoSessionToken } : {}),
        },
        token,
        timeoutMs,
      );
      setMessage(payload.message ?? `${label} completed.`);
      clearApiCache();
      await loadDashboard(stateFilters);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      setBusyAction(null);
    }
  }

  const totalCases = overview?.statusCounts.total_cases ?? 0;
  const approvedCases = overview?.statusCounts.approved_cases ?? 0;
  const rejectedCases = overview?.statusCounts.rejected_cases ?? 0;
  const pendingApprovalCases = Math.max(totalCases - approvedCases - rejectedCases, 0);
  const pendingChanges = overview?.changeCounts.pending_changes ?? 0;
  const householdRows = overview?.listingCounts.household_rows ?? 0;
  const buildingsListed = overview?.listingCounts.buildings_listed ?? 0;
  const sampledHouseholds = overview?.listingCounts.sampled_households ?? 0;
  const stateEaSummary = overview?.stateEaSummary ?? [];
  const totalEas = stateEaSummary.reduce((sum, row) => sum + row.totalEas, 0);
  const completedEas = stateEaSummary.reduce((sum, row) => sum + row.completedEas, 0);
  const approvedEas = stateEaSummary.reduce((sum, row) => sum + row.approvedEas, 0);
  const rejectedEas = stateEaSummary.reduce((sum, row) => sum + (row.rejectedEas ?? 0), 0);
  const pendingApprovalEas = Math.max(totalEas - approvedEas - rejectedEas, 0);
  const pendingEas = pendingApprovalCases;
  const executiveSummary = buildExecutiveSummary({
    stateFilter: stateFilters.length === 0 ? "all" : stateFilters.join(", "),
    totalEas,
    approvedEas,
    householdRows,
    sampledHouseholds,
    pendingReviewEas: pendingEas,
    pendingChanges,
    lastSync: overview?.syncState?.last_successful_completion_utc,
  });
  const hasBacklog = pendingEas + pendingChanges > 0;
  const visibleStateBoundaryFeatures = useMemo(
    () =>
      (stateBoundaries?.features ?? []).filter((feature) =>
        matchesState(getBoundaryStateName(feature as Record<string, unknown>), stateFilter),
      ),
    [stateBoundaries?.features, stateFilter],
  );
  const allStateBoundaryFeatures = stateBoundaries?.features ?? [];
  const visibleMapFeatures = useMemo(
    () => (mapData?.features ?? []).filter((feature) => matchesState(getFeatureStateName(feature), stateFilter)),
    [mapData?.features, stateFilter],
  );
  const visibleGpsPoints = useMemo(
    () => (mapData?.gpsPoints ?? []).filter((point) => matchesState(point.state_name, stateFilter)),
    [mapData?.gpsPoints, stateFilter],
  );
  const visibleAllocationRows = useMemo(
    () =>
      stateFilters.length === 0
        ? stateEaSummary
        : stateEaSummary.filter((row) =>
            stateFilters.some((f) => normalizeStateName(row.state) === normalizeStateName(f)),
          ),
    [stateEaSummary, stateFilters],
  );
  const allocationRowsWithComputed = useMemo(
    () =>
      visibleAllocationRows.map((row) => {
        const targetEas = row.targetEas || row.totalEas;
        const approved = row.approvedEas;
        const rejected = row.rejectedEas ?? 0;
        return {
          ...row,
          _pendingEas: Math.max(row.totalEas - approved - rejected, 0),
          _remainingEas: Math.max(targetEas - approved, 0),
        };
      }),
    [visibleAllocationRows],
  );
  const { sorted: sortedAllocationRows, sortKey: tableSortKey, sortDir: tableSortDir, handleSort: handleTableSort } = useSortedTable(allocationRowsWithComputed);
  const tableTargetEasTotal = useMemo(
    () => visibleAllocationRows.reduce((sum, row) => sum + (row.targetEas || row.totalEas), 0),
    [visibleAllocationRows],
  );
  const tableRemainingEasTotal = useMemo(
    () =>
      visibleAllocationRows.reduce((sum, row) => sum + Math.max((row.targetEas || row.totalEas) - row.approvedEas, 0), 0),
    [visibleAllocationRows],
  );
  const tableApprovedEasTotal = useMemo(
    () => visibleAllocationRows.reduce((sum, row) => sum + row.approvedEas, 0),
    [visibleAllocationRows],
  );
  const tableCompletedEasTotal = useMemo(
    () => visibleAllocationRows.reduce((sum, row) => sum + row.totalEas, 0),
    [visibleAllocationRows],
  );
  const tableRejectedEasTotal = useMemo(
    () => visibleAllocationRows.reduce((sum, row) => sum + (row.rejectedEas ?? 0), 0),
    [visibleAllocationRows],
  );
  const tablePendingApprovalEasTotal = Math.max(tableCompletedEasTotal - tableApprovedEasTotal - tableRejectedEasTotal, 0);

  const overviewCards = [
    {
      title: "Region",
      rows: [
        { label: "FCT", value: 940, pct: 11.8, color: "bg-sky-500" },
        { label: "Imo", value: 910, pct: 11.4, color: "bg-emerald-500" },
        { label: "Oyo", value: 890, pct: 11.1, color: "bg-amber-500" },
        { label: "Rivers", value: 870, pct: 10.9, color: "bg-violet-500" },
        { label: "Kano", value: 850, pct: 10.6, color: "bg-rose-500" },
        { label: "Kwara", value: 840, pct: 10.5, color: "bg-blue-500" },
        { label: "Delta", value: 820, pct: 10.3, color: "bg-teal-500" },
        { label: "Edo", value: 788, pct: 9.9, color: "bg-cyan-500" },
        { label: "Ogun", value: 642, pct: 8.0, color: "bg-indigo-500" },
        { label: "Enugu", value: 450, pct: 5.6, color: "bg-lime-500" },
      ],
    },
    {
      title: "Income",
      rows: [
        { label: "N500,001 - N800,000", value: 1584, pct: 19.8, color: "bg-sky-500" },
        { label: "N150,001 - N300,000", value: 1272, pct: 15.9, color: "bg-emerald-500" },
        { label: "N300,001 - N500,000", value: 1224, pct: 15.3, color: "bg-amber-500" },
        { label: "Don't know/refused", value: 1160, pct: 14.5, color: "bg-violet-500" },
        { label: "Above 1,000,000", value: 1000, pct: 12.5, color: "bg-rose-500" },
        { label: "Less than N150,000", value: 752, pct: 9.4, color: "bg-blue-500" },
        { label: "N800,001 - N1,000,000", value: 680, pct: 8.5, color: "bg-teal-500" },
        { label: "Have no income", value: 328, pct: 4.1, color: "bg-cyan-500" },
      ],
    },
    {
      title: "SEC",
      rows: [
        { label: "SEC D", value: 3032, pct: 37.9, color: "bg-sky-500" },
        { label: "SEC BC1", value: 2496, pct: 31.2, color: "bg-emerald-500" },
        { label: "SEC C2", value: 2472, pct: 30.9, color: "bg-amber-500" },
      ],
    },
    {
      title: "Week",
      rows: [
        { label: "Week 2", value: 2368, pct: 29.6, color: "bg-sky-500" },
        { label: "Week 4", value: 1992, pct: 24.9, color: "bg-emerald-500" },
        { label: "Week 3", value: 1984, pct: 24.8, color: "bg-amber-500" },
        { label: "Week 1", value: 1656, pct: 20.7, color: "bg-violet-500" },
      ],
    },
  ];

  const donutCards = [
    {
      title: "Gender",
      style: "conic-gradient(#0ea5e9 0deg 180deg, #10b981 180deg 360deg)",
      legend: [
        { label: "Female", value: "50%", color: "bg-sky-500" },
        { label: "Male", value: "50%", color: "bg-emerald-500" },
      ],
      labels: ["Female 50%", "Male 50%"],
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
  const selectedStateTotal = stateFilters.length
    ? overviewCards[0].rows.filter((row) => stateFilters.includes(row.label)).reduce((sum, row) => sum + row.value, 0)
    : 8000;
  const visibleOverviewCards = overviewCards.map((card) => {
    if (card.title === "Region") {
      const rows = stateFilters.length ? card.rows.filter((row) => stateFilters.includes(row.label)) : card.rows;
      return { ...card, rows };
    }
    const factor = selectedStateTotal / 8000;
    return {
      ...card,
      rows: card.rows.map((row) => ({ ...row, value: Math.max(1, Math.round(row.value * factor)) })),
    };
  });
  const setOverviewCardView = (title: string, view: OverviewCardView) => {
    setOverviewCardViews((current) => ({ ...current, [title]: view }));
  };
  const toggleOverviewMetricMode = (title: string) => {
    setOverviewMetricModes((current) => ({ ...current, [title]: (current[title] ?? "percent") === "percent" ? "count" : "percent" }));
  };
  const toggleOverviewDecimals = (title: string) => {
    setOverviewDecimals((current) => ({ ...current, [title]: ((current[title] ?? 0) + 1) % 3 }));
  };
  const donutRows = (card: (typeof donutCards)[number]): OverviewCardRow[] =>
    card.legend.map((entry) => {
      const pct = Number(entry.value.replace("%", ""));
      return { label: entry.label, value: Math.round((pct / 100) * selectedStateTotal), pct, color: entry.color };
    });
  const topOverviewRow = (title: string) =>
    visibleOverviewCards.find((card) => card.title === title)?.rows.reduce((top, row) => (row.value > top.value ? row : top));
  const listingRegionTop = topOverviewRow("Region");
  const listingIncomeTop = topOverviewRow("Income");
  const listingSecTop = topOverviewRow("SEC");
  const listingWeekTop = topOverviewRow("Week");
  const listingGenderRows = donutRows(donutCards[0]);
  const listingAgeRows = donutRows(donutCards[1]);
  const listingGenderTop = listingGenderRows.reduce((top, row) => (row.value > top.value ? row : top));
  const listingAgeTop = listingAgeRows.reduce((top, row) => (row.value > top.value ? row : top));
  const listingScopeText = stateFilters.length ? stateFilters.join(", ") : "the displayed states";

  return (
    <PlatformPage title="Overview - Demographics" subtitle="" module="listing" plainTopBar syncLabel="">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[1.5rem] border border-white/55 bg-gradient-to-br from-slate-100/85 via-sky-50/70 to-emerald-50/70 px-6 py-5 text-center shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <h2 className="text-lg font-semibold text-slate-950">Executive Summary</h2>
          <p className="mx-auto mt-2 max-w-5xl text-sm leading-7 text-slate-700">
            The listing overview is currently scoped to <strong>{listingScopeText}</strong> with <strong>{selectedStateTotal.toLocaleString()}</strong> cases. <strong>{listingRegionTop?.label ?? "Region"}</strong> has the largest regional count at <strong>{listingRegionTop?.value.toLocaleString() ?? "0"}</strong>, the leading income band is <strong>{listingIncomeTop?.label ?? "Income"}</strong> at <strong>{listingIncomeTop?.value.toLocaleString() ?? "0"}</strong>, and gender is led by <strong>{listingGenderTop.label}</strong> at <strong>{listingGenderTop.pct.toFixed(0)}%</strong>. The age profile is concentrated among <strong>{listingAgeTop.label}</strong> at <strong>{listingAgeTop.pct.toFixed(0)}%</strong>, the largest socioeconomic segment is <strong>{listingSecTop?.label ?? "SEC"}</strong> at <strong>{listingSecTop?.value.toLocaleString() ?? "0"}</strong>, and <strong>{listingWeekTop?.label ?? "Week"}</strong> contributes the highest weekly count at <strong>{listingWeekTop?.value.toLocaleString() ?? "0"}</strong>.
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-[1.25rem] border border-white/60 bg-white/45 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700">Overview controls</p>
            <p className="mt-1 text-sm text-slate-600">Use state selection to scope listing summaries where source data is available.</p>
          </div>
          <div className="md:min-w-[320px]">
            <MultiSelectDropdown
              label="States"
              options={(overviewCards[0].rows.map((row) => row.label)).map((s) => ({ value: s, label: s }))}
              selected={stateFilters}
              onChange={setStateFilters}
            />
          </div>
        </section>

        {message ? (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
            {message}
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-2">
          {visibleOverviewCards.slice(0, 2).map((card) => (
            <div key={card.title} className="rounded-[1.4rem] border border-white/65 bg-white/38 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} onViewChange={(view) => setOverviewCardView(card.title, view)} onMetricToggle={() => toggleOverviewMetricMode(card.title)} onDecimalsToggle={() => toggleOverviewDecimals(card.title)} onDownload={() => downloadOverviewCardCsv(card.title, card.rows)} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} /> : <div className="space-y-2">
                {card.rows.map((row) => (
                  <div key={row.label} className="rounded-xl border border-white/55 bg-white/46 px-4 py-3">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-800">
                      <span>{row.label}</span>
                      <span>{row.value} ({row.pct.toFixed(1)}%)</span>
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
          {donutCards.map((card) => (
            <div key={card.title} className="rounded-[1.4rem] border border-white/65 bg-white/38 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} onViewChange={(view) => setOverviewCardView(card.title, view)} onMetricToggle={() => toggleOverviewMetricMode(card.title)} onDecimalsToggle={() => toggleOverviewDecimals(card.title)} onDownload={() => downloadOverviewCardCsv(card.title, donutRows(card))} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={donutRows(card)} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} /> : <div className="flex min-h-[180px] items-center justify-around rounded-xl border border-white/60 bg-white/35 p-5">
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
          {visibleOverviewCards.slice(2).map((card) => (
            <div key={card.title} className="rounded-[1.4rem] border border-white/65 bg-white/38 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-sky-700">{card.title}</h3>
                <OverviewCardToolbar view={overviewCardViews[card.title] ?? "chart"} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} onViewChange={(view) => setOverviewCardView(card.title, view)} onMetricToggle={() => toggleOverviewMetricMode(card.title)} onDecimalsToggle={() => toggleOverviewDecimals(card.title)} onDownload={() => downloadOverviewCardCsv(card.title, card.rows)} />
              </div>
              {(overviewCardViews[card.title] ?? "chart") === "table" ? <OverviewTableView title={card.title} rows={card.rows} metricMode={overviewMetricModes[card.title] ?? "percent"} decimals={overviewDecimals[card.title] ?? 0} /> : <div className="space-y-2">
                {card.rows.map((row) => (
                  <div key={row.label} className="rounded-xl border border-white/55 bg-white/46 px-4 py-3">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-800">
                      <span>{row.label}</span>
                      <span>{row.value} ({row.pct.toFixed(1)}%)</span>
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
      title="Overview"
      subtitle=""
      module={module}
      plainTopBar
      syncLabel=""
    >
      <div className="space-y-6">
        <section>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-5xl space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Executive Summary</p>
              <p className="text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                For <strong>{executiveSummary.scopeLabel}</strong>, <strong>{executiveSummary.totalEasText}</strong> Wards are
                currently tracked, <strong>{executiveSummary.householdRowsText}</strong> households have been listed, and{" "}
                <strong>{executiveSummary.sampledHouseholdsText}</strong> households have been sampled.{" "}
                {approvedEas > 0 ? (
                  <Fragment>
                    <strong>{executiveSummary.approvedEasText}</strong> Wards are approved, putting completion at{" "}
                    <strong>{executiveSummary.completionRateText}</strong>.
                  </Fragment>
                ) : (
                  <Fragment>
                    No Wards are fully approved yet, so completion remains at{" "}
                    <strong>{executiveSummary.completionRateText}</strong>.
                  </Fragment>
                )}{" "}
                {hasBacklog ? (
                  <Fragment>
                    <strong>{executiveSummary.pendingReviewText}</strong> Wards are still remaining and{" "}
                    <strong>{executiveSummary.pendingChangesText}</strong> pending corrections still need attention.
                  </Fragment>
                ) : null}
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center lg:shrink-0">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">State Filter</p>
              <div className="grid gap-3 md:min-w-[280px]">
                <MultiSelectDropdown
                  label="States"
                  options={availableStates.map((s) => ({ value: s, label: s }))}
                  selected={stateFilters}
                  onChange={setStateFilters}
                />
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/30 dark:bg-amber-950/30 dark:text-amber-300">
            {message}
          </div>
        ) : null}

        <KpiStrip
          items={[
            { label: "Target Wards", value: formatFull(tableTargetEasTotal), tone: "blue" },
            {
              label: "Completed Wards",
              value: formatFull(totalCases),
              meta: tableTargetEasTotal > 0 ? `${Math.round((totalCases / tableTargetEasTotal) * 100)}% of target` : undefined,
              tone: "blue",
            },
            {
              label: "Approved Wards",
              value: formatFull(approvedCases),
              meta: totalCases > 0 ? `${Math.round((approvedCases / totalCases) * 100)}% approval` : undefined,
              tone: "emerald",
            },
            {
              label: "Rejected Wards",
              value: formatFull(rejectedCases),
              meta: totalCases > 0 ? `${Math.round((rejectedCases / totalCases) * 100)}% rejected` : undefined,
              tone: rejectedCases > 0 ? "rose" : "slate",
            },
            {
              label: "Pending Wards",
              value: formatFull(pendingApprovalCases),
              meta: totalCases > 0 ? `${Math.round((pendingApprovalCases / totalCases) * 100)}% pending` : undefined,
              tone: pendingApprovalCases > 0 ? "amber" : "slate",
            },
            { label: "Buildings", value: formatFull(buildingsListed), tone: "blue" },
            { label: "Households", value: formatFull(householdRows), tone: "blue" },
            { label: "Sampled", value: formatFull(sampledHouseholds), tone: "emerald" },
          ]}
        />

        <section className="flex flex-wrap gap-2 rounded-2xl border border-blue-100/80 bg-white/80 p-2 shadow-sm dark:border-sky-200/60 dark:bg-white/74">
          {[
            { id: "map", label: "Geospatial View" },
            { id: "completion", label: "Ward Completion Rate by State" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setOverviewTab(tab.id as "map" | "completion")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                overviewTab === tab.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-blue-950/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </section>

        {overviewTab === "map" ? (
        <section>
          <Card className="glass-panel overflow-hidden">
            <CardContent className="p-0">
              <div className="h-[68vh] min-h-[420px] w-full">
                <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} scrollWheelZoom attributionControl={false} className="h-full w-full">
                  <MapViewportController
                    mapFeatures={visibleMapFeatures}
                    gpsPoints={visibleGpsPoints}
                    stateBoundaryFeatures={visibleStateBoundaryFeatures}
                    stateFilter={stateFilter}
                  />
                  <MapViewportDataLoader onViewportChange={handleViewportChange} />
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  />
                  {allStateBoundaryFeatures.length ? (
                    <GeoJSON
                      data={{ type: "FeatureCollection", features: allStateBoundaryFeatures } as GeoJsonObject}
                      style={(feature) => {
                        const isSelected = matchesState(
                          getBoundaryStateName((feature ?? {}) as Record<string, unknown>),
                          stateFilter,
                        );

                        return {
                          color: isSelected && stateFilter !== "all" ? "#0f766e" : "#e2e8f0",
                          weight: isSelected && stateFilter !== "all" ? 2.8 : 2.2,
                          opacity: 0.95,
                          fillColor: isSelected && stateFilter !== "all" ? "#14b8a6" : "#ffffff",
                          fillOpacity: isSelected && stateFilter !== "all" ? 0.04 : 0.02,
                        };
                      }}
                      onEachFeature={(feature, layer) => {
                        const properties = (feature.properties ?? {}) as Record<string, unknown>;
                        layer.bindPopup(
                          `<strong>${String(properties.statename ?? properties.state_name ?? "State")}</strong>`,
                        );
                      }}
                    />
                  ) : null}
                  {visibleMapFeatures.length ? (
                    <GeoJSON
                      data={{ type: "FeatureCollection", features: visibleMapFeatures } as GeoJsonObject}
                      style={(feature) => {
                        const properties = (feature?.properties ?? {}) as Record<string, unknown>;
                        const latestStatus = String(properties.latestStatus ?? "");
                        const isApproved = latestStatus === "approved";

                        return {
                          color: isApproved ? "#16a34a" : "#94a3b8",
                          weight: 2.4,
                          fillColor: isApproved ? "#4ade80" : "#cbd5e1",
                          fillOpacity: 0.16,
                        };
                      }}
                      onEachFeature={(feature, layer) => {
                        const properties = (feature.properties ?? {}) as Record<string, unknown>;
                        layer.bindPopup(
                          `<strong>${String(properties.sd_EA_NAME ?? "Ward")}</strong><br/>Ward ID: ${String(properties.sd_EA_ID ?? "-")}<br/>Cases: ${String(properties.caseCount ?? 0)}<br/>Open Issues: ${String(properties.openIssueCount ?? 0)}`,
                        );
                      }}
                    />
                  ) : null}
                  {visibleGpsPoints.map((point) => {
                    const pointColors = getGpsPointColors(point.row_type);
                    return (
                      <CircleMarker
                        key={point.point_id}
                        center={[point.gps_lat, point.gps_long]}
                        radius={point.sample_flag ? 5 : 3}
                        pathOptions={{
                          color: pointColors.stroke,
                          fillColor: pointColors.fill,
                          fillOpacity: 0.85,
                          weight: 1,
                        }}
                      >
                        <Popup>
                          <div className="space-y-1 text-sm">
                            <div className="font-semibold">{point.ea_name ?? "Ward"}</div>
                            <div>Submission: {point.submission_key}</div>
                            <div>Row type: {point.row_type}</div>
                            <div>Status: {point.approval_status ?? "-"}</div>
                            <div>Sampled: {point.sample_flag ? "Yes" : "No"}</div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
              </div>
            </CardContent>
          </Card>
        </section>
        ) : null}

        {overviewTab === "completion" ? (
        <section>
          <Card className="glass-panel overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-3 border-b border-white/60 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ward Completion Rate by State</h2>
                {canExportTables ? (
                  <button
                    type="button"
                    onClick={() =>
                      downloadEaCompletionCsv(
                        visibleAllocationRows,
                        tableTargetEasTotal,
                        tableCompletedEasTotal,
                        tableApprovedEasTotal,
                        tableRejectedEasTotal,
                        tablePendingApprovalEasTotal,
                        tableRemainingEasTotal,
                      )
                    }
                    title="Download CSV"
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/6 dark:text-slate-400 dark:hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download CSV
                  </button>
                ) : null}
              </div>

              <Table className="border-collapse border border-slate-300/90">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[160px] cursor-pointer border-0 bg-transparent" onClick={() => handleTableSort("state")}>State {tableSortKey === "state" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer border-0 bg-transparent text-center" onClick={() => handleTableSort("targetEas")}>No of Target Wards {tableSortKey === "targetEas" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer border-0 bg-transparent text-center" onClick={() => handleTableSort("totalEas")}>Total Completed Wards {tableSortKey === "totalEas" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer border-0 bg-transparent text-center" onClick={() => handleTableSort("approvedEas")}>No of Approved Wards {tableSortKey === "approvedEas" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer border-0 bg-transparent text-center" onClick={() => handleTableSort("rejectedEas")}>Rejected Wards {tableSortKey === "rejectedEas" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer border-0 bg-transparent text-center" onClick={() => handleTableSort("_pendingEas")}>Pending Approval Wards {tableSortKey === "_pendingEas" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer border-0 bg-transparent text-center" onClick={() => handleTableSort("_remainingEas")}>No of Remaining Wards {tableSortKey === "_remainingEas" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAllocationRows.map((row) => {
                    const targetEas = row.targetEas || row.totalEas;
                    const completedEasRow = row.totalEas;
                    const approvedEasRow = row.approvedEas;
                    const rejectedEasRow = row.rejectedEas ?? 0;
                    const pendingApprovalEasRow = row._pendingEas;
                    const remainingEas = row._remainingEas;
                    const progressPct = targetEas > 0 ? Math.min(100, (approvedEasRow / targetEas) * 100) : 0;

                    return (
                    <TableRow key={row.state}>
                      <TableCell className="border border-slate-300/90">
                        <div className="space-y-1.5">
                          <span className="font-semibold text-slate-900">{row.state}</span>
                          <div className="h-1.5 w-full rounded-full bg-slate-200/80">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border-0 text-center font-semibold tabular-nums text-slate-900">
                        {targetEas.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-semibold tabular-nums text-slate-900">
                        {completedEasRow.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-semibold tabular-nums text-emerald-700">
                        {approvedEasRow.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-semibold tabular-nums text-rose-700">
                        {rejectedEasRow.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-semibold tabular-nums text-amber-700">
                        {pendingApprovalEasRow.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-semibold tabular-nums text-slate-900">
                        {remainingEas.toLocaleString("en-US")}
                      </TableCell>
                    </TableRow>
                  )})}
                  {stateFilters.length === 0 ? (
                    <TableRow className="bg-slate-50/80 dark:bg-white/3 hover:bg-slate-50 dark:hover:bg-white/4">
                      <TableCell className="font-semibold text-slate-800 dark:text-slate-200">Grand Total</TableCell>
                      <TableCell className="border-0 text-center font-bold tabular-nums text-slate-900">
                        {tableTargetEasTotal.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-bold tabular-nums text-slate-900">
                        {tableCompletedEasTotal.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-bold tabular-nums text-emerald-700">
                        {tableApprovedEasTotal.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-bold tabular-nums text-rose-700">
                        {tableRejectedEasTotal.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-bold tabular-nums text-amber-700">
                        {tablePendingApprovalEasTotal.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="border-0 text-center font-bold tabular-nums text-slate-900">
                        {tableRemainingEasTotal.toLocaleString("en-US")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
        ) : null}
      </div>
    </PlatformPage>
  );
}
