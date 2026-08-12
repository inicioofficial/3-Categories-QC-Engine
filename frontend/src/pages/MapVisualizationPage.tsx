import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject } from "geojson";
import L from "leaflet";
import { Search, X } from "lucide-react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { PlatformPage, formatToken, statusBadgeClass } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { ListingQualityTabs } from "@/components/listing/ListingQualityTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSurveyWorkspace } from "@/data/workspaces";
import {
  apiFetch,
  apiFetchCached,
  type DashboardOverview,
  type ListingMapPayload,
  type MapGpsPoint,
  type StateBoundariesPayload,
} from "@/lib/api";

const DEFAULT_MAP_CENTER: [number, number] = [9.082, 8.6753];
const DEFAULT_MAP_ZOOM = 6;
const MAP_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "rejected", label: "Rejected" },
] as const;
const MAP_REQUEST_ROLES = new Set(["SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"]);
const MAP_VIEWPORT_LIMIT = 750;

type BhtMapSummary = {
  totalCases: number;
  mappedCases: number;
  missingGpsCases: number;
  interviewerCount: number;
  returnedPoints: number;
  limit: number;
  weekCounts: Record<string, number>;
};

type BhtMapPoint = MapGpsPoint & {
  case_id: string;
  city: string | null;
  sector: string | null;
  week: string | null;
  survey_month: string | null;
  interviewer_id: string | null;
  submitted_at: string | null;
  selected_panel_labels?: string | null;
  gender?: string | null;
  bau5aAnswers: string[];
};

type BhtMapPayload = {
  category: {
    slug: string;
    label: string;
    panelCode: string | null;
  };
  monthsAvailable: string[];
  monthsSelected: string[];
  sectorsAvailable?: string[];
  sectorsSelected?: string[];
  gpsPoints: BhtMapPoint[];
  summary: BhtMapSummary;
};

const SYNTHETIC_MAP_REGIONS = [
  { name: "Abuja", state: "FCT", lat: 9.0765, lng: 7.3986, cases: 940, gps: 940, status: "approved" },
  { name: "Owerri", state: "Imo", lat: 5.485, lng: 7.035, cases: 910, gps: 910, status: "in_progress" },
  { name: "Ibadan", state: "Oyo", lat: 7.3775, lng: 3.947, cases: 890, gps: 890, status: "approved" },
  { name: "PHC", state: "Rivers", lat: 4.8156, lng: 7.0498, cases: 870, gps: 870, status: "in_progress" },
  { name: "Kano", state: "Kano", lat: 12.0022, lng: 8.592, cases: 850, gps: 850, status: "rejected" },
  { name: "Ilorin", state: "Kwara", lat: 8.4966, lng: 4.5421, cases: 840, gps: 840, status: "approved" },
  { name: "Warri", state: "Delta", lat: 5.5544, lng: 5.7932, cases: 820, gps: 820, status: "in_progress" },
  { name: "Benin", state: "Edo", lat: 6.335, lng: 5.6037, cases: 788, gps: 788, status: "approved" },
  { name: "Abeokuta", state: "Ogun", lat: 7.1475, lng: 3.3619, cases: 642, gps: 642, status: "approved" },
  { name: "Enugu", state: "Enugu", lat: 6.5244, lng: 7.5086, cases: 450, gps: 450, status: "in_progress" },
];

const BHT_CITY_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#4f46e5",
  "#0f766e",
  "#ca8a04",
  "#7c3aed",
  "#0284c7",
  "#65a30d",
  "#db2777",
  "#475569",
];

const BHT_WEEK_COLORS: Record<string, string> = {
  "Week 1": "#2563eb",
  "Week 2": "#16a34a",
  "Week 3": "#f97316",
  "Week 4": "#9333ea",
};

function buildSyntheticWardFeature(region: (typeof SYNTHETIC_MAP_REGIONS)[number], index: number) {
  const latStep = 0.055 + (index % 3) * 0.008;
  const lngStep = 0.065 + (index % 4) * 0.007;
  return {
    type: "Feature",
    properties: {
      sd_EA_ID: `${region.name.toUpperCase()}-EA-${String(index + 1).padStart(3, "0")}`,
      sd_EA_NAME: `${region.name} Coverage Ward`,
      sd_STATE_NAME: region.name,
      statename: region.name,
      state_name: region.name,
      latestStatus: region.status,
      caseCount: region.cases,
      openIssueCount: region.status === "approved" ? 0 : index + 2,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [region.lng - lngStep, region.lat - latStep],
        [region.lng + lngStep * 0.75, region.lat - latStep * 0.85],
        [region.lng + lngStep, region.lat + latStep * 0.55],
        [region.lng - lngStep * 0.45, region.lat + latStep],
        [region.lng - lngStep, region.lat - latStep],
      ]],
    },
  };
}

const SYNTHETIC_GEOJSON_FEATURES = SYNTHETIC_MAP_REGIONS.map(buildSyntheticWardFeature);

const SYNTHETIC_DASHBOARD_OVERVIEW: DashboardOverview = {
  statusCounts: { total_cases: 8000, approved_cases: 4710, rejected_cases: 850 },
  listingCounts: { household_rows: 8000, buildings_listed: 1742, sampled_households: 1936 },
  issueCounts: {},
  changeCounts: { pending_changes: 244 },
  syncState: {},
  stateEaSummary: SYNTHETIC_MAP_REGIONS.map((region) => ({
    state: region.name,
    targetEas: region.cases,
    totalEas: region.cases,
    completedEas: region.cases,
    approvedEas: region.status === "approved" ? region.cases : Math.round(region.cases * 0.62),
    rejectedEas: region.status === "rejected" ? Math.round(region.cases * 0.32) : Math.round(region.cases * 0.06),
  })),
};

const SYNTHETIC_MAP_DATA: ListingMapPayload = {
  type: "FeatureCollection",
  features: SYNTHETIC_GEOJSON_FEATURES,
  gpsPoints: SYNTHETIC_MAP_REGIONS.flatMap((region) =>
    Array.from({ length: Math.min(region.gps, 120) }, (_, index) => {
      const offset = (index % 20) * 0.006;
      const rowOffset = Math.floor(index / 20) * 0.006;
      return {
        point_id: `synthetic-${region.name}-${index}`,
        submission_key: `SYN-${region.name.toUpperCase()}-${String(index + 1).padStart(4, "0")}`,
        ea_id: `${region.name.toUpperCase()}-EA-${String((index % 30) + 1).padStart(3, "0")}`,
        row_type: index % 8 === 0 ? "building_only" : "household",
        sample_flag: index % 5 === 0,
        gps_lat: region.lat + offset - 0.06,
        gps_long: region.lng + rowOffset - 0.03,
        approval_status: region.status,
        ea_name: region.name,
        state_name: region.name,
      };
    }),
  ),
  summary: { eaCount: 10, gpsPointCount: 8000, approvedEaCount: 5, issueEaCount: 3 },
};

type EaDecision = "approved" | "rejected";

type SelectedEa = {
  eaId: string;
  eaName: string;
  stateName: string;
  latestStatus: string;
  caseCount: number;
  openIssueCount: number;
  position: [number, number];
};

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatFull(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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

function normalizeStatus(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (["submitted", "pending_review", "in_review", "corrected", "in_progress"].includes(normalized)) {
    return "in_progress";
  }

  if (normalized === "approved" || normalized === "rejected") {
    return normalized;
  }

  return "";
}

function matchesStatus(value: string | null | undefined, statusFilter: string) {
  return statusFilter === "all" || normalizeStatus(value) === statusFilter;
}

function getFeatureLatestStatus(feature: Record<string, unknown>) {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return String(properties.latestStatus ?? "").trim();
}

function getFeaturePopupPosition(feature: Record<string, unknown>) {
  const layer = L.geoJSON(feature as unknown as GeoJsonObject);
  const bounds = layer.getBounds();
  if (!bounds.isValid()) return null;
  const center = bounds.getCenter();
  return [center.lat, center.lng] as [number, number];
}

function getGpsPointColors(rowType: string) {
  return rowType === "building_only"
    ? { stroke: "#b91c1c", fill: "#ef4444" }
    : { stroke: "#2563eb", fill: "#3b82f6" };
}

function getBhtPointColors(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  if (normalized === "approved") return { stroke: "#047857", fill: "#10b981" };
  if (normalized === "rejected") return { stroke: "#be123c", fill: "#f43f5e" };
  return { stroke: "#1d4ed8", fill: "#3b82f6" };
}

function colorToStroke(color: string) {
  return color;
}

function colorToFill(color: string) {
  return color;
}

function PanelHeader({
  eyebrow,
  title,
  badge,
}: {
  eyebrow: string;
  title: string;
  badge?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
        <h3 className="mt-2 text-xl font-semibold text-slate-900">{title}</h3>
      </div>
      {badge ? (
        <div className="rounded-full border border-white/70 bg-white/42 px-3 py-1.5 text-xs font-medium text-slate-600">
          {badge}
        </div>
      ) : null}
    </div>
  );
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
  fitKey,
  preferGpsBounds = false,
}: {
  mapFeatures: Array<Record<string, unknown>>;
  gpsPoints: MapGpsPoint[];
  stateBoundaryFeatures: Array<Record<string, unknown>>;
  stateFilter: string;
  fitKey: string;
  preferGpsBounds?: boolean;
}) {
  const map = useMap();
  const bounds = useMemo(
    () => buildViewportBounds(mapFeatures, gpsPoints, preferGpsBounds && gpsPoints.length ? [] : stateBoundaryFeatures),
    [gpsPoints, mapFeatures, preferGpsBounds, stateBoundaryFeatures],
  );
  const stateBounds = useMemo(() => buildStateBoundaryBounds(stateBoundaryFeatures), [stateBoundaryFeatures]);
  const validGpsPoints = useMemo(
    () => gpsPoints.filter((point) => Number.isFinite(point.gps_lat) && Number.isFinite(point.gps_long)),
    [gpsPoints],
  );

  useEffect(() => {
    if (!bounds) {
      map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
      return;
    }

    if (preferGpsBounds && validGpsPoints.length === 1) {
      const point = validGpsPoints[0];
      map.setView([point.gps_lat, point.gps_long], 13);
      return;
    }

    if (!preferGpsBounds && stateFilter !== "all" && stateBounds) {
      const padding = L.point(8, 8);
      const zoom = Math.min(map.getBoundsZoom(stateBounds, false, padding), 12);
      map.setView(stateBounds.getCenter(), zoom);
      return;
    }

    map.fitBounds(bounds, {
      padding: stateFilter === "all" ? [28, 28] : [8, 8],
      maxZoom: preferGpsBounds ? 13 : stateFilter === "all" ? DEFAULT_MAP_ZOOM : 12,
    });
  }, [fitKey, map, preferGpsBounds, stateBounds, stateFilter, validGpsPoints]);

  return null;
}

function MapEaFocusController({
  mapFeatures,
  eaFilter,
}: {
  mapFeatures: Array<Record<string, unknown>>;
  eaFilter: string;
}) {
  const map = useMap();
  const prevEaFilter = useRef("");

  useEffect(() => {
    if (!eaFilter || eaFilter === prevEaFilter.current) return;
    prevEaFilter.current = eaFilter;

    const feature = mapFeatures.find((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      return String(props.sd_EA_ID ?? "") === eaFilter || String(props.sd_EA_NAME ?? "").toLowerCase() === eaFilter.toLowerCase();
    });
    if (!feature) return;

    const layer = L.geoJSON(feature as unknown as GeoJsonObject);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
    }
  }, [eaFilter, map, mapFeatures]);

  return null;
}

type MapVisualizationPageProps = {
  module?: "listing" | "main";
};

function MainGeospatialView() {
  const { token, selectedWorkspace } = useAuth();
  const selectedCategories: string[] = [];
  const workspace = getSurveyWorkspace(selectedWorkspace);
  const activeCategory = { slug: selectedWorkspace ?? "all", label: workspace?.label ?? "Selected Category", panelCode: null };
  const categoryFilterLabel = activeCategory.label;
  const [payload, setPayload] = useState<BhtMapPayload | null>(null);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [interviewerFilter, setInterviewerFilter] = useState<string[]>([]);
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [colorMode, setColorMode] = useState<"city" | "week" | "sector">("city");
  const [message, setMessage] = useState<string | null>(null);
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundariesPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/NGA_State_Boundaries.geojson")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load state boundaries: ${response.status}`);
        }
        return response.json() as Promise<StateBoundariesPayload>;
      })
      .then((boundaryPayload) => {
        if (cancelled) return;
        setStateBoundaries({
          type: "FeatureCollection",
          features: Array.isArray(boundaryPayload.features) ? boundaryPayload.features : [],
        });
      })
      .catch((error) => {
        console.warn("Unable to load state boundary GeoJSON", error);
        if (!cancelled) {
          setStateBoundaries({ type: "FeatureCollection", features: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      category: activeCategory.slug,
      limit: "10000",
    });
    setPayload(null);
    setMessage(null);

    apiFetchCached<BhtMapPayload>(`/api/main-survey/map?${params.toString()}`, {}, token, { forceRefresh: true, timeoutMs: 45_000 })
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("Unable to load geospatial data right now.");
          setPayload({
            category: { slug: activeCategory.slug, label: activeCategory.label, panelCode: activeCategory.panelCode },
            monthsAvailable: [],
            monthsSelected: [],
            sectorsAvailable: [],
            sectorsSelected: selectedSectors,
            gpsPoints: [],
            summary: { totalCases: 0, mappedCases: 0, missingGpsCases: 0, interviewerCount: 0, returnedPoints: 0, limit: 10000, weekCounts: {} },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCategory.label, activeCategory.panelCode, activeCategory.slug, token]);

  function pointDay(point: BhtMapPoint) {
    const raw = point.submitted_at ?? "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  function matchesDayRange(point: BhtMapPoint) {
    const day = pointDay(point);
    if (!day) return !dayFrom && !dayTo;
    return (!dayFrom || day >= dayFrom) && (!dayTo || day <= dayTo);
  }

  const optionScopedPoints = useMemo(() => payload?.gpsPoints ?? [], [payload?.gpsPoints]);
  const availableCities = useMemo(() => {
    const rows = optionScopedPoints.filter((point) => {
      const sector = point.sector || "";
      const interviewer = point.interviewer_id || "";
      const statusOk = !statusFilter.length || statusFilter.some((status) => matchesStatus(point.approval_status, status));
      return (!selectedSectors.length || selectedSectors.includes(sector)) && (!interviewerFilter.length || interviewerFilter.includes(interviewer)) && statusOk && matchesDayRange(point);
    });
    return Array.from(new Set(rows.map((point) => point.city || point.state_name || "").filter(Boolean))).sort();
  }, [dayFrom, dayTo, interviewerFilter, optionScopedPoints, selectedSectors, statusFilter]);
  const availableSectors = useMemo(() => {
    const rows = optionScopedPoints.filter((point) => {
      const city = point.city || point.state_name || "";
      const interviewer = point.interviewer_id || "";
      const statusOk = !statusFilter.length || statusFilter.some((status) => matchesStatus(point.approval_status, status));
      return (!cityFilter.length || cityFilter.includes(city)) && (!interviewerFilter.length || interviewerFilter.includes(interviewer)) && statusOk && matchesDayRange(point);
    });
    return Array.from(new Set(rows.map((point) => point.sector || "").filter(Boolean))).sort();
  }, [cityFilter, dayFrom, dayTo, interviewerFilter, optionScopedPoints, statusFilter]);
  const availableInterviewers = useMemo(() => {
    const rows = optionScopedPoints.filter((point) => {
      const city = point.city || point.state_name || "";
      const sector = point.sector || "";
      const statusOk = !statusFilter.length || statusFilter.some((status) => matchesStatus(point.approval_status, status));
      return (!cityFilter.length || cityFilter.includes(city)) && (!selectedSectors.length || selectedSectors.includes(sector)) && statusOk && matchesDayRange(point);
    });
    return Array.from(new Set(rows.map((point) => point.interviewer_id || "").filter(Boolean))).sort();
  }, [cityFilter, dayFrom, dayTo, optionScopedPoints, selectedSectors, statusFilter]);

  useEffect(() => {
    if (cityFilter.length && availableCities.length) {
      setCityFilter((current) => {
        const next = current.filter((city) => availableCities.includes(city));
        return next.length === current.length && next.every((city, index) => city === current[index]) ? current : next;
      });
    }
  }, [availableCities, cityFilter]);

  useEffect(() => {
    if (selectedSectors.length && availableSectors.length) {
      setSelectedSectors((current) => {
        const next = current.filter((sector) => availableSectors.includes(sector));
        return next.length === current.length && next.every((sector, index) => sector === current[index]) ? current : next;
      });
    }
  }, [availableSectors, selectedSectors]);

  useEffect(() => {
    if (interviewerFilter.length && availableInterviewers.length) {
      setInterviewerFilter((current) => {
        const next = current.filter((interviewer) => availableInterviewers.includes(interviewer));
        return next.length === current.length && next.every((interviewer, index) => interviewer === current[index]) ? current : next;
      });
    }
  }, [availableInterviewers, interviewerFilter]);

  const visibleGpsPoints = useMemo(
    () =>
      (payload?.gpsPoints ?? []).filter((point) => {
        const city = point.city || point.state_name || "";
        const sector = point.sector || "";
        const interviewer = point.interviewer_id || "";
        const statusOk = !statusFilter.length || statusFilter.some((status) => matchesStatus(point.approval_status, status));
        return (!cityFilter.length || cityFilter.includes(city)) && (!selectedSectors.length || selectedSectors.includes(sector)) && (!interviewerFilter.length || interviewerFilter.includes(interviewer)) && statusOk && matchesDayRange(point);
      }),
    [cityFilter, dayFrom, dayTo, interviewerFilter, payload?.gpsPoints, selectedSectors, statusFilter],
  );

  const cityColorMap = useMemo(() => {
    const cities = Array.from(new Set((payload?.gpsPoints ?? []).map((point) => point.city || point.state_name || "Unknown"))).sort();
    return new Map(cities.map((city, index) => [city, BHT_CITY_COLORS[index % BHT_CITY_COLORS.length]]));
  }, [payload?.gpsPoints]);

  const sectorColorMap = useMemo(() => {
    const sectors = Array.from(new Set((payload?.gpsPoints ?? []).map((point) => point.sector || "Unknown"))).sort();
    return new Map(sectors.map((sector, index) => [sector, BHT_CITY_COLORS[index % BHT_CITY_COLORS.length]]));
  }, [payload?.gpsPoints]);

  const summary = payload?.summary ?? {
    totalCases: 0,
    mappedCases: 0,
    missingGpsCases: 0,
    interviewerCount: 0,
    returnedPoints: 0,
    limit: 10000,
    weekCounts: {},
  };

  const weekCounts = summary.weekCounts ?? {};
  const boundaryFeatures = stateBoundaries?.features ?? [];
  const legendItems = colorMode === "week"
    ? Object.entries(BHT_WEEK_COLORS).map(([label, color]) => ({ label, color }))
    : colorMode === "sector"
      ? Array.from(sectorColorMap.entries()).slice(0, 10).map(([label, color]) => ({ label, color }))
      : Array.from(cityColorMap.entries()).slice(0, 10).map(([label, color]) => ({ label, color }));

  function getPointColor(point: BhtMapPoint) {
    if (colorMode === "week") {
      return BHT_WEEK_COLORS[point.week || ""] ?? "#64748b";
    }
    if (colorMode === "sector") {
      return sectorColorMap.get(point.sector || "Unknown") ?? "#2563eb";
    }
    return cityColorMap.get(point.city || point.state_name || "Unknown") ?? "#2563eb";
  }

  function BhtPointPopup({ point }: { point: BhtMapPoint }) {
    const [bau5aAnswers, setBau5aAnswers] = useState<string[] | null>(
      activeCategory.slug === "omnibus" || activeCategory.slug === "all" || selectedCategories.length !== 1 ? [] : point.bau5aAnswers ?? null,
    );

    useEffect(() => {
      if (activeCategory.slug === "omnibus" || activeCategory.slug === "all" || selectedCategories.length !== 1 || bau5aAnswers?.length) return;
      let cancelled = false;
      apiFetchCached<{ bau5aAnswers: string[] }>(
        `/api/main-survey/map-points/${encodeURIComponent(point.case_id)}/bau5a?category=${encodeURIComponent(activeCategory.slug)}`,
        {},
        token,
        { forceRefresh: true, timeoutMs: 20_000 },
      )
        .then((payload) => {
          if (!cancelled) setBau5aAnswers(payload.bau5aAnswers ?? []);
        })
        .catch(() => {
          if (!cancelled) setBau5aAnswers([]);
        });
      return () => {
        cancelled = true;
      };
    }, [activeCategory.slug, bau5aAnswers?.length, point.case_id, selectedCategories.length, token]);

    return (
      <div className="space-y-1 text-sm">
        <div className="font-semibold">{point.city ?? "Respondent location"}</div>
        <div>Selected panels: {point.selected_panel_labels || "Omnibus"}</div>
        <div>Gender: {point.gender || "-"}</div>
        <div>GPS point: {point.gps_lat.toFixed(6)}, {point.gps_long.toFixed(6)}</div>
        <div>Survey month: {point.survey_month ?? "-"}</div>
        <div>Week: {point.week ?? "-"}</div>
        <div>Sector: {point.sector ?? "-"}</div>
        <div>Interviewer: {point.interviewer_id ?? "-"}</div>
        {activeCategory.slug !== "omnibus" && activeCategory.slug !== "all" && selectedCategories.length === 1 ? (
          <div>BAU5a: {bau5aAnswers === null ? "Loading..." : bau5aAnswers.length ? bau5aAnswers.join(", ") : "-"}</div>
        ) : null}
        <div>Submission: {point.submission_key}</div>
        <div>Status: {formatToken(point.approval_status ?? "pending_review")}</div>
      </div>
    );
  }

  return (
    <PlatformPage
      title="Geospatial View"
      subtitle={`${categoryFilterLabel} respondent GPS coverage from the monthly BHT tracker.`}
      syncLabel={payload ? `${formatFull(visibleGpsPoints.length)} visible points` : "Loading map data"}
      module="main"
    >
      <div className="space-y-6">
        <KpiStrip
          items={[
            { label: "Category cases", value: formatFull(summary.totalCases), tone: "blue" },
            { label: "Mapped GPS", value: formatFull(summary.mappedCases), tone: "emerald" },
            { label: "Missing GPS", value: formatFull(summary.missingGpsCases), tone: summary.missingGpsCases ? "amber" : "slate" },
            { label: "Interviewers", value: formatFull(summary.interviewerCount), tone: "blue" },
            { label: "Week 1", value: formatFull(weekCounts["Week 1"] ?? 0), tone: "blue" },
            { label: "Week 2", value: formatFull(weekCounts["Week 2"] ?? 0), tone: "emerald" },
            { label: "Week 3", value: formatFull(weekCounts["Week 3"] ?? 0), tone: "amber" },
            { label: "Week 4", value: formatFull(weekCounts["Week 4"] ?? 0), tone: "slate" },
          ]}
        />

        <Card className="glass-panel overflow-hidden">
          <CardContent className="p-0">
            <div className="relative z-[60] border-b border-white/60 bg-white/80 px-4 py-4 backdrop-blur sm:px-6">
              <div className="grid gap-3 2xl:grid-cols-[minmax(220px,1fr)_auto] 2xl:items-start">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Respondent map</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">{categoryFilterLabel}</h3>
                </div>

                <div className="relative z-[70] grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:w-auto 2xl:min-w-[1320px] 2xl:grid-cols-10">
                  <MultiSelectDropdown
                    label="City"
                    options={availableCities.map((city) => ({ value: city, label: city }))}
                    selected={cityFilter}
                    onChange={setCityFilter}
                  />

                  <MultiSelectDropdown
                    label="Sector"
                    options={availableSectors.map((sector) => ({ value: sector, label: sector }))}
                    selected={selectedSectors}
                    onChange={setSelectedSectors}
                  />

                  <MultiSelectDropdown
                    label="Interviewer"
                    options={availableInterviewers.map((interviewer) => ({ value: interviewer, label: interviewer }))}
                    selected={interviewerFilter}
                    onChange={setInterviewerFilter}
                  />

                  <MultiSelectDropdown
                    label="statuses"
                    options={MAP_STATUS_OPTIONS.filter((opt) => opt.value !== "all").map((opt) => ({ value: opt.value, label: opt.label }))}
                    selected={statusFilter}
                    onChange={setStatusFilter}
                  />

                  <div className="inline-flex h-10 w-full overflow-hidden rounded-[1.1rem] border border-slate-200 bg-white p-0.5 text-xs shadow-sm 2xl:col-span-2">
                    {(["city", "week", "sector"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setColorMode(mode)}
                        className={`flex-1 rounded-[0.9rem] px-3 font-bold capitalize transition ${
                          colorMode === mode ? "bg-blue-600 text-white shadow-sm" : "text-slate-900 hover:bg-slate-100"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Date from</span>
                    <input
                      type="date"
                      value={dayFrom}
                      onChange={(event) => setDayFrom(event.target.value)}
                      aria-label="Date from"
                      className="h-10 w-full rounded-[1.1rem] border border-slate-200 bg-white px-3 pt-3 text-xs font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Date to</span>
                    <input
                      type="date"
                      value={dayTo}
                      onChange={(event) => setDayTo(event.target.value)}
                      aria-label="Date to"
                      className="h-10 w-full rounded-[1.1rem] border border-slate-200 bg-white px-3 pt-3 text-xs font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 shadow-sm">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Legend</span>
                  {legendItems.map((entry) => (
                    <span key={entry.label} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      {entry.label}
                    </span>
                  ))}
                </div>
                <div className="ml-auto grid h-9 place-items-center rounded-[1rem] border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm">
                  {formatFull(visibleGpsPoints.length)} visible
                </div>
              </div>
              {message ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">{message}</div> : null}
            </div>

            <div className="relative z-0 h-[75vh] min-h-[520px] w-full">
              <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} scrollWheelZoom className="relative z-0 h-full w-full">
                <MapViewportController
                  mapFeatures={[]}
                  gpsPoints={visibleGpsPoints}
                  stateBoundaryFeatures={boundaryFeatures}
                  stateFilter="all"
                  fitKey={`${selectedCategories.join(",")}:${cityFilter.join(",")}:${selectedSectors.join(",")}:${interviewerFilter.join(",")}:${statusFilter.join(",")}:${dayFrom}:${dayTo}:${visibleGpsPoints.length}`}
                  preferGpsBounds
                />
                <TileLayer
                  attribution="Tiles &copy; Esri"
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />
                {boundaryFeatures.length ? (
                  <GeoJSON
                    interactive={false}
                    data={{ type: "FeatureCollection", features: boundaryFeatures } as GeoJsonObject}
                    style={{
                      color: "#f8fafc",
                      weight: 1.8,
                      opacity: 0.95,
                      fillColor: "#ffffff",
                      fillOpacity: 0.03,
                    }}
                  />
                ) : null}
                {visibleGpsPoints.map((point) => {
                  const pointColor = getPointColor(point);
                  return (
                    <CircleMarker
                      key={point.point_id}
                      center={[point.gps_lat, point.gps_long]}
                      radius={6}
                      pathOptions={{
                        color: colorToStroke(pointColor),
                        fillColor: colorToFill(pointColor),
                        fillOpacity: 0.82,
                        weight: 1,
                      }}
                    >
                      <Popup>
                        <BhtPointPopup point={point} />
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
}

export function MapVisualizationPage({ module = "listing" }: MapVisualizationPageProps) {
  if (module === "main") {
    return <MainGeospatialView />;
  }

  const { token, user } = useAuth();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [mapData, setMapData] = useState<ListingMapPayload | null>(null);
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundariesPayload | null>(null);
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [eaFilter, setEaFilter] = useState("");
  const [eaSearchOpen, setEaSearchOpen] = useState(false);
  const [selectedEa, setSelectedEa] = useState<SelectedEa | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<EaDecision | null>(null);
  const [mapViewportBounds, setMapViewportBounds] = useState<MapViewportBounds | null>(null);
  const [requestReason, setRequestReason] = useState("");
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const canRequestReview = user ? MAP_REQUEST_ROLES.has(user.role) : false;
  const mapRequestRef = useRef(0);

  useEffect(() => {
    async function loadMap() {
      setOverview(SYNTHETIC_DASHBOARD_OVERVIEW);
      setMapData(SYNTHETIC_MAP_DATA);

      try {
        const response = await fetch("/NGA_State_Boundaries.geojson", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unable to load state boundaries: ${response.status}`);
        }

        const boundaryPayload = (await response.json()) as StateBoundariesPayload;
        const boundaryFeatures = Array.isArray(boundaryPayload.features) ? boundaryPayload.features : [];
        const boundaryStates = Array.from(
          new Set(
            boundaryFeatures
              .map((feature) => getBoundaryStateName(feature as Record<string, unknown>))
              .filter(Boolean),
          ),
        );

        setStateBoundaries({
          type: "FeatureCollection",
          features: boundaryFeatures.length ? boundaryFeatures : SYNTHETIC_GEOJSON_FEATURES,
        });
        setAvailableStates(
          Array.from(new Set([...boundaryStates, ...SYNTHETIC_MAP_REGIONS.map((region) => region.name)])).sort(),
        );
      } catch (error) {
        console.warn("Falling back to synthetic map boundaries", error);
        setStateBoundaries({ type: "FeatureCollection", features: SYNTHETIC_GEOJSON_FEATURES });
        setAvailableStates(SYNTHETIC_MAP_REGIONS.map((region) => region.name));
      }
    }

    void loadMap();
  }, [refreshKey, stateFilter, token]);

  const mapViewportKey = viewportKey(mapViewportBounds);

  useEffect(() => {
    if (!mapViewportBounds) return;
    setMapData(SYNTHETIC_MAP_DATA);
  }, [token, stateFilter, mapViewportBounds, mapViewportKey]);

  const handleViewportChange = useCallback((bounds: MapViewportBounds) => {
    setMapViewportBounds((previous) => (viewportKey(previous) === viewportKey(bounds) ? previous : bounds));
  }, []);

  const visibleStateBoundaryFeatures = useMemo(
    () =>
      (stateBoundaries?.features ?? []).filter((feature) =>
        matchesState(getBoundaryStateName(feature as Record<string, unknown>), stateFilter),
      ),
    [stateBoundaries?.features, stateFilter],
  );
  const allStateBoundaryFeatures = stateBoundaries?.features ?? [];
  const visibleMapFeatures = useMemo(
    () =>
      (mapData?.features ?? []).filter(
        (feature) =>
          matchesState(getFeatureStateName(feature), stateFilter) &&
          matchesStatus(getFeatureLatestStatus(feature), statusFilter),
      ),
    [mapData?.features, stateFilter, statusFilter],
  );
  const visibleGpsPoints = useMemo(
    () =>
      (mapData?.gpsPoints ?? []).filter(
        (point) => matchesState(point.state_name, stateFilter) && matchesStatus(point.approval_status, statusFilter),
      ),
    [mapData?.gpsPoints, stateFilter, statusFilter],
  );
  const filteredSummary = useMemo(
    () => ({
      eaCount: visibleMapFeatures.length,
      gpsPointCount: visibleGpsPoints.length,
      approvedEaCount: visibleMapFeatures.filter((feature) => normalizeStatus(getFeatureLatestStatus(feature)) === "approved")
        .length,
      issueEaCount: visibleMapFeatures.filter((feature) => {
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        return Number(properties.openIssueCount ?? 0) > 0;
      }).length,
    }),
    [visibleGpsPoints, visibleMapFeatures],
  );
  const eaOptions = useMemo(
    () =>
      visibleMapFeatures.map((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return {
          id: String(props.sd_EA_ID ?? ""),
          name: String(props.sd_EA_NAME ?? props.sd_EA_ID ?? ""),
        };
      }).filter((ea) => ea.id),
    [visibleMapFeatures],
  );

  const householdRows = overview?.listingCounts.household_rows ?? 0;
  const buildingsListed = overview?.listingCounts.buildings_listed ?? 0;
  const sampledHouseholds = overview?.listingCounts.sampled_households ?? 0;
  const stateEaSummary = overview?.stateEaSummary ?? [];
  const totalEas = stateEaSummary.reduce((sum, row) => sum + row.totalEas, 0);
  const approvedEas = stateEaSummary.reduce((sum, row) => sum + row.approvedEas, 0);
  const rejectedEas = stateEaSummary.reduce((sum, row) => sum + (row.rejectedEas ?? 0), 0);
  const pendingReviewEas = Math.max(totalEas - approvedEas, 0);

  useEffect(() => {
    if (!selectedEa) return;

    const matchingFeature = visibleMapFeatures.find((feature) => {
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      return String(properties.sd_EA_ID ?? "") === selectedEa.eaId;
    });

    if (!matchingFeature) {
      setSelectedEa(null);
      setSelectedDecision(null);
      setRequestReason("");
      setRequestMessage(null);
      return;
    }

    const properties = (matchingFeature.properties ?? {}) as Record<string, unknown>;
    const nextPosition = getFeaturePopupPosition(matchingFeature);
    if (!nextPosition) return;

    const nextEa = {
      eaId: selectedEa.eaId,
      eaName: String(properties.sd_EA_NAME ?? selectedEa.eaName),
      stateName: String(properties.sd_STATE_NAME ?? selectedEa.stateName),
      latestStatus: String(properties.latestStatus ?? selectedEa.latestStatus),
      caseCount: Number(properties.caseCount ?? selectedEa.caseCount),
      openIssueCount: Number(properties.openIssueCount ?? selectedEa.openIssueCount),
      position: nextPosition,
    };

    const hasChanged =
      nextEa.eaName !== selectedEa.eaName ||
      nextEa.stateName !== selectedEa.stateName ||
      nextEa.latestStatus !== selectedEa.latestStatus ||
      nextEa.caseCount !== selectedEa.caseCount ||
      nextEa.openIssueCount !== selectedEa.openIssueCount ||
      nextEa.position[0] !== selectedEa.position[0] ||
      nextEa.position[1] !== selectedEa.position[1];

    if (hasChanged) {
      setSelectedEa(nextEa);
    }
  }, [selectedEa, visibleMapFeatures]);

  function resetEaRequestState() {
    setSelectedDecision(null);
    setRequestReason("");
    setRequestMessage(null);
  }

  async function submitEaReviewRequest() {
    if (!selectedEa || !selectedDecision || !requestReason.trim()) return;

    setIsSubmittingRequest(true);
    setRequestMessage(null);

    try {
      const payload = await apiFetch<{ affectedCount: number }>(
        `/api/listing/eas/${encodeURIComponent(selectedEa.eaId)}/review-request`,
        {
          method: "POST",
          body: JSON.stringify({
            decision: selectedDecision,
            reason: requestReason.trim(),
          }),
        },
        token,
      );

      setSelectedEa((current) =>
        current
          ? {
              ...current,
              latestStatus: "pending_review",
            }
          : current,
      );
      setRequestMessage(`Submitted for ${payload.affectedCount} submission${payload.affectedCount === 1 ? "" : "s"}.`);
      setSelectedDecision(null);
      setRequestReason("");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setRequestMessage("Unable to submit this map request right now.");
    } finally {
      setIsSubmittingRequest(false);
    }
  }

  return (
    <PlatformPage
      title="Geospatial View"
      subtitle=""
      syncLabel=""
      module={module}
    >
      <div className="space-y-6">
        <ListingQualityTabs />

        <KpiStrip
          items={[
            { label: "Mapped Wards", value: formatFull(totalEas), tone: "blue" },
            {
              label: "Approved Wards",
              value: formatFull(approvedEas),
              meta: totalEas > 0 ? `${Math.round((approvedEas / totalEas) * 100)}% approval` : undefined,
              tone: "emerald",
            },
            {
              label: "Rejected Wards",
              value: formatFull(rejectedEas),
              meta: totalEas > 0 ? `${Math.round((rejectedEas / totalEas) * 100)}% rejected` : undefined,
              tone: rejectedEas > 0 ? "rose" : "slate",
            },
            {
              label: "Pending Wards",
              value: formatFull(pendingReviewEas),
              meta: totalEas > 0 ? `${Math.round((pendingReviewEas / totalEas) * 100)}% pending` : undefined,
              tone: pendingReviewEas > 0 ? "amber" : "slate",
            },
            { label: "Buildings", value: formatFull(buildingsListed), tone: "blue" },
            { label: "Households", value: formatFull(householdRows), tone: "blue" },
            { label: "Sampled", value: formatFull(sampledHouseholds), tone: "emerald" },
            { label: "GPS Points", value: formatFull(filteredSummary.gpsPointCount), tone: "blue" },
          ]}
        />

        <Card className="glass-panel overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b border-white/60 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Coverage map</p>

                <div className="flex flex-wrap items-center gap-2">
                  <Select value={stateFilter} onValueChange={setStateFilter}>
                    <SelectTrigger className="h-9 min-w-[170px] rounded-[1.1rem] border-white/70 bg-white/44 text-xs text-slate-900">
                      <SelectValue placeholder="Select region" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All regions</SelectItem>
                      {Array.from(new Set([...availableStates, ...SYNTHETIC_MAP_REGIONS.map((region) => region.name)])).map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Ward status filter - compact select */}
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-9 cursor-pointer appearance-none rounded-[1.1rem] border border-white/70 bg-white/44 px-3 pr-7 text-xs font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus:outline-none focus:ring-2 focus:ring-ring"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 0.6rem center" }}
                  >
                    {MAP_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  {/* Ward search filter */}
                  <div className="relative">
                    <div className="flex h-9 items-center gap-2 rounded-[1.1rem] border border-white/70 bg-white/44 pl-3 pr-2 text-xs text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                      <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Jump to Ward..."
                        className="w-[140px] bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
                        value={eaFilter}
                        onChange={(e) => {
                          setEaFilter(e.target.value);
                          setEaSearchOpen(e.target.value.length > 0);
                        }}
                        onFocus={() => setEaSearchOpen(eaFilter.length > 0)}
                        onBlur={() => setTimeout(() => setEaSearchOpen(false), 160)}
                      />
                      {eaFilter ? (
                        <button
                          type="button"
                          onClick={() => { setEaFilter(""); setEaSearchOpen(false); }}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {eaSearchOpen && eaOptions.length > 0 ? (
                      <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-64 overflow-y-auto rounded-2xl border border-white/70 bg-white/95 shadow-xl backdrop-blur-sm">
                        {eaOptions
                          .filter((ea) =>
                            ea.id.toLowerCase().includes(eaFilter.toLowerCase()) ||
                            ea.name.toLowerCase().includes(eaFilter.toLowerCase()),
                          )
                          .slice(0, 30)
                          .map((ea) => (
                            <button
                              key={ea.id}
                              type="button"
                              className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition hover:bg-primary/8"
                              onMouseDown={() => {
                                setEaFilter(ea.id);
                                setEaSearchOpen(false);
                              }}
                            >
                              <span className="truncate text-xs font-semibold text-slate-900">{ea.name}</span>
                              <span className="font-mono text-[10px] text-slate-400">{ea.id}</span>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-full border border-white/70 bg-white/42 px-3 py-1.5 text-xs font-medium text-slate-600">
                    {filteredSummary.eaCount} mapped Wards
                  </div>
                </div>
              </div>
            </div>

            <div className="h-[75vh] min-h-[520px] w-full">
              <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} scrollWheelZoom className="h-full w-full">
                <MapViewportController
                  mapFeatures={visibleMapFeatures}
                  gpsPoints={visibleGpsPoints}
                  stateBoundaryFeatures={visibleStateBoundaryFeatures}
                  stateFilter={stateFilter}
                  fitKey={`${stateFilter}:${statusFilter}:${visibleMapFeatures.length}:${visibleGpsPoints.length}`}
                />
                <MapViewportDataLoader onViewportChange={handleViewportChange} />
                <MapEaFocusController mapFeatures={visibleMapFeatures} eaFilter={eaFilter} />
                <TileLayer
                  attribution="Tiles &copy; Esri"
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
                      layer.on("click", () => {
                        const properties = (feature.properties ?? {}) as Record<string, unknown>;
                        const position = getFeaturePopupPosition(feature as unknown as Record<string, unknown>);
                        if (!position) return;

                        setSelectedEa({
                          eaId: String(properties.sd_EA_ID ?? ""),
                          eaName: String(properties.sd_EA_NAME ?? "Ward"),
                          stateName: String(properties.sd_STATE_NAME ?? "-"),
                          latestStatus: String(properties.latestStatus ?? ""),
                          caseCount: Number(properties.caseCount ?? 0),
                          openIssueCount: Number(properties.openIssueCount ?? 0),
                          position,
                        });
                        setSelectedDecision(null);
                        setRequestReason("");
                        setRequestMessage(null);
                      });
                    }}
                  />
                ) : null}
                {selectedEa ? (
                  <Popup
                    key={`${selectedEa.eaId}-${selectedEa.latestStatus}-${selectedEa.caseCount}`}
                    position={selectedEa.position}
                    minWidth={320}
                    autoClose={false}
                    closeButton={false}
                    closeOnClick={false}
                  >
                    <div
                      className="w-[320px] space-y-4 p-1 text-sm text-slate-700"
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold text-slate-900">{selectedEa.eaName}</div>
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedEa(null);
                              resetEaRequestState();
                            }}
                          >
                            Close
                          </button>
                        </div>
                        <div>State: {selectedEa.stateName}</div>
                        <div>Ward ID: {selectedEa.eaId}</div>
                        <div>Submissions: {selectedEa.caseCount}</div>
                        <div>Open issues: {selectedEa.openIssueCount}</div>
                        <div>
                          Status:{" "}
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(selectedEa.latestStatus || "pending_review")}`}>
                            {formatToken(selectedEa.latestStatus || "pending_review")}
                          </span>
                        </div>
                      </div>

                      {canRequestReview ? (
                        <>
                          {!selectedDecision ? (
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                className="h-9 rounded-xl border border-emerald-500/25 bg-emerald-500/12 text-xs text-emerald-700 hover:bg-emerald-500/20"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedDecision("approved");
                                  setRequestMessage(null);
                                }}
                              >
                                Approve
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 rounded-xl border-rose-500/25 bg-rose-500/10 text-xs text-rose-700 hover:bg-rose-500/20"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedDecision("rejected");
                                  setRequestMessage(null);
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                This will move all submissions under this Ward to <strong>Pending Review</strong>. Final approval or rejection still happens in Listing Review detail.
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                                  Reason for {selectedDecision === "approved" ? "approval" : "rejection"} request
                                </label>
                                <Textarea
                                  value={requestReason}
                                  onChange={(event) => setRequestReason(event.target.value)}
                                  onClick={(event) => event.stopPropagation()}
                                  onFocus={(event) => event.stopPropagation()}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  className="min-h-[110px] resize-none rounded-2xl"
                                  placeholder="Enter the reason for this Ward request"
                                />
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                Your name is recorded automatically as <strong>{user?.fullName ?? user?.username ?? "Unknown user"}</strong>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  className="h-9 flex-1 rounded-xl text-xs"
                                  disabled={isSubmittingRequest || requestReason.trim().length < 3}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void submitEaReviewRequest();
                                  }}
                                >
                                  {isSubmittingRequest ? "Submitting..." : "Submit request"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 rounded-xl text-xs"
                                  disabled={isSubmittingRequest}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    resetEaRequestState();
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          Your role can view Ward details here but cannot submit review requests from the map.
                        </div>
                      )}

                      {requestMessage ? (
                        <div className="rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary">
                          {requestMessage}
                        </div>
                      ) : null}
                    </div>
                  </Popup>
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
                        <div>State: {point.state_name ?? "-"}</div>
                        <div>Submission: {point.submission_key}</div>
                        <div>Row type: {point.row_type}</div>
                        <div>Status: {point.approval_status ?? "-"}</div>
                      </div>
                    </Popup>
                  </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
}
