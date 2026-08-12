import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { GeoJsonObject } from "geojson";
import L from "leaflet";
import { ArrowLeft, ArrowRight, CheckCheck, ClipboardPenLine, History, Maximize2, MapPinned, ShieldAlert, Sparkles, ThumbsUp, X } from "lucide-react";
import { CircleMarker, GeoJSON, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { EmptyState, INPUT_CLASS, MetricLine, PlatformPage, SELECT_CLASS, formatDate, formatToken, statusBadgeClass } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, type CaseListItem, type IssueItem, type ListingCaseDetail } from "@/lib/api";

type ReviewTab = "issues" | "correction" | "changes" | "history";

type SampleStatusFilter = "Main Sample" | "Replacement Sample";
type GpsPoint = { lat: number; lng: number; rowType: string; sampleFlag: boolean; sampleStatus: string | null };

const NIGERIA_CENTER: [number, number] = [9.082, 8.6753];
const SAMPLE_STATUS_OPTIONS: SampleStatusFilter[] = ["Main Sample", "Replacement Sample"];
const LISTING_RULE_DEFINITIONS: Record<string, string> = {
  LISTING_MISSING_GPS: "Listing row has no GPS coordinates.",
  LISTING_GPS_OUT_OF_BOUNDS: "GPS point falls outside expected bounds.",
  LISTING_DUPLICATE_GPS: "GPS point duplicates another submission by same interviewer.",
  LISTING_DUPLICATE_JOIN_KEY: "Duplicate listing join key found.",
  LISTING_HOUSEHOLD_NUMBERING_GAP: "Household/building numbering is missing or out of order.",
  LISTING_INVALID_LISTING_NUMERIC: "Listing numeric fields contain invalid values.",
  LISTING_INVALID_TEMPLATE_NUMERIC: "Template numeric fields contain invalid values.",
  LISTING_DUPLICATE_PHONE_NO: "Phone number appears in multiple listing submissions.",
  LISTING_LOI_TOO_SHORT: "Listing interview duration is too short.",
  LISTING_LOI_TOO_LONG: "Listing interview duration is too long.",
  LISTING_GAP_BETWEEN_INTERVIEWS: "Gap between interviews is too short.",
  LISTING_TIME_INTERWOVEN: "Interview times overlap for same interviewer.",
  LISTING_INSUFFICIENT_VALID_GPS: "Ward has missing or zero GPS points.",
  LISTING_OUTSIDE_POLYGON: "One or more listing GPS points fall outside the Ward polygon.",
  LISTING_LOW_POLYGON_COVERAGE: "Ward GPS points are too concentrated to support spatial auto-approval.",
  LISTING_HH_COUNT_SEQUENCE_MISMATCH: "Declared household count conflicts with household sequence.",
  LISTING_ROSTER_TOTAL_MISMATCH: "Roster totals do not match household size.",
  LISTING_INELIGIBLE_SAMPLE_FLAG: "Sampled household is ineligible or incomplete.",
  LISTING_SELECTED_JOIN_KEY_MISSING_MATCH: "Selected join key has no listing match.",
  LISTING_DUPLICATE_SAMPLE_CASE_ID: "Sample case ID appears more than once.",
  LISTING_SAMPLE_COUNT_MISMATCH: "Sampled and selected household counts do not match.",
  LISTING_MISSING_EA_ID: "Ward identifier is missing.",
  LISTING_DATE_SEQUENCE_ERROR: "Completion timestamp is before submission/start timestamp.",
  LISTING_SPARSE_COVERAGE_LOW_POINT_COUNT: "Ward has sparse GPS/coverage evidence.",
};

const sampledHouseholdStarIcon = L.divIcon({
  className: "sampled-household-star-marker",
  html: '<div style="font-size:20px;line-height:1;color:#facc15;text-shadow:0 0 1px #854d0e, 0 0 7px rgba(133,77,14,0.4);">★</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function SnapshotFitController({ feature }: { feature: Record<string, unknown> | null }) {
  const map = useMap();
  useEffect(() => {
    if (!feature) return;
    const layer = L.geoJSON(feature as unknown as GeoJsonObject);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [16, 16] });
    }
  }, [feature, map]);
  return null;
}

function buildIssueOptionLabel(issue: IssueItem) {
  const parts = [issue.case_label, issue.field_name, issue.issue_summary].filter(Boolean);
  return parts.join(" | ");
}

function CaseStatusBadge({ status, reviewerName }: { status: string; reviewerName: string | null }) {
  if (status === "approved") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-emerald-700">
        <ThumbsUp className="h-5 w-5 shrink-0" />
        <span className="text-sm font-semibold">
          Approved{reviewerName ? ` by ${reviewerName}` : ""}
        </span>
      </div>
    );
  }

  if (status === "rejected" || status === "cancelled") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-rose-700">
        <X className="h-6 w-6 shrink-0 stroke-[3]" />
        <span className="text-sm font-semibold">
          {status === "cancelled" ? "Cancelled" : "Rejected"}{reviewerName ? ` by ${reviewerName}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-2">
      <span className="text-sm font-bold uppercase tracking-widest text-amber-700">Pending</span>
    </div>
  );
}

function SummaryCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function normalizeSampleStatus(value: unknown): SampleStatusFilter | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "main sample") return "Main Sample";
  if (text === "replacement sample") return "Replacement Sample";
  return null;
}

function shouldShowSnapshotPoint(
  point: GpsPoint,
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

function SnapshotPointMarker({ point, index }: { point: GpsPoint; index: number }) {
  if (point.sampleFlag && point.rowType !== "building_only") {
    return <Marker key={`star-${index}`} position={[point.lat, point.lng]} icon={sampledHouseholdStarIcon} />;
  }

  const colors =
    point.rowType === "building_only"
      ? { stroke: "#b91c1c", fill: "#ef4444" }
      : { stroke: "#2563eb", fill: "#3b82f6" };

  return (
    <CircleMarker
      key={`dot-${index}`}
      center={[point.lat, point.lng]}
      radius={point.rowType === "building_only" ? 3.5 : 4}
      pathOptions={{
        color: colors.stroke,
        fillColor: colors.fill,
        fillOpacity: 0.85,
        weight: 1,
      }}
    />
  );
}

type ListingCaseDetailPageProps = {
  module?: "listing" | "main";
};

export function ListingCaseDetailPage({ module = "listing" }: ListingCaseDetailPageProps) {
  const { token, user } = useAuth();
  const { submissionKey = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ListingCaseDetail | null>(null);
  const [eaFeature, setEaFeature] = useState<Record<string, unknown> | null>(null);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [showNonResidential, setShowNonResidential] = useState(true);
  const [selectedSampleStatuses, setSelectedSampleStatuses] = useState<SampleStatusFilter[]>([...SAMPLE_STATUS_OPTIONS]);
  const [fallbackQueueSubmissionKeys, setFallbackQueueSubmissionKeys] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ReviewTab>("issues");
  const [status, setStatus] = useState("in_review");
  const [statusNote, setStatusNote] = useState("");
  const [correction, setCorrection] = useState({
    issueId: "",
    caseId: "",
    caseLabel: "",
    issueSummary: "",
    tableName: "",
    rowIdentifier: "",
    fieldName: "",
    currentValue: "",
    proposedValue: "",
    reason: "",
  });
  const [message, setMessage] = useState<string | null>(null);

  const mockWorkspaceCase = {
    submissionKey,
    eaName: "Garki Central",
    region: "Abuja",
    status: "pending_review",
    interviewer: "int_abj_01",
    households: 142,
    sampled: 34,
    buildings: 18,
    issues: [
      { label: "Duplicate GPS cluster", severity: "High", detail: "12 household points are tightly clustered near the Ward boundary." },
      { label: "Non-residential ratio", severity: "Medium", detail: "Building-only records exceed the expected listing benchmark." },
      { label: "Household sequence gap", severity: "Medium", detail: "Household numbering skips two positions in the listing roster." },
    ],
  };
  const listingQueueKeys = Array.from({ length: 24 }, (_, index) => `LISTING-SUB-${String(index + 1).padStart(4, "0")}`);
  const visibleListingQueue = listingQueueKeys.includes(submissionKey) ? listingQueueKeys : [submissionKey || listingQueueKeys[0], ...listingQueueKeys.slice(1)];
  const listingQueueIndex = Math.max(0, visibleListingQueue.indexOf(submissionKey || listingQueueKeys[0]));
  const listingPreviousKey = listingQueueIndex > 0 ? visibleListingQueue[listingQueueIndex - 1] : null;
  const listingNextKey = listingQueueIndex < visibleListingQueue.length - 1 ? visibleListingQueue[listingQueueIndex + 1] : null;
  const goToListingCase = (targetKey: string | null) => {
    if (!targetKey) return;
    navigate({ pathname: `/listing/cases/${encodeURIComponent(targetKey)}`, search: location.search }, { state: { queueSubmissionKeys: visibleListingQueue } });
  };

  return (
    <PlatformPage title="Listing Data - Individual Ward level" subtitle="" syncLabel="" module={module}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link to={`/listing/cases${location.search}`} className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/70">
            <ArrowLeft className="h-4 w-4" />
            Back to Listing Data Explorer
          </Link>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={!listingPreviousKey} onClick={() => goToListingCase(listingPreviousKey)} className="rounded-2xl">
              Prev
            </Button>
            <span className="rounded-full bg-blue-600 px-4 py-2 text-xs font-black text-white">
              Page {listingQueueIndex + 1} / {visibleListingQueue.length}
            </span>
            <Button type="button" variant="outline" disabled={!listingNextKey} onClick={() => goToListingCase(listingNextKey)} className="rounded-2xl">
              Next
            </Button>
            <Button className="rounded-2xl bg-emerald-600 hover:bg-emerald-700">Approve case</Button>
            <Button variant="outline" className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50">Return for correction</Button>
          </div>
        </div>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.6rem] border border-white/60 bg-white/24 p-6 text-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">Case command center</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">{mockWorkspaceCase.eaName}</h1>
            <p className="mt-2 text-sm text-slate-600">{mockWorkspaceCase.region} · {mockWorkspaceCase.submissionKey || "Synthetic listing case"}</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white/45 p-4"><p className="text-xs text-slate-500">Households</p><p className="mt-2 text-2xl font-bold">{mockWorkspaceCase.households}</p></div>
              <div className="rounded-2xl bg-white/45 p-4"><p className="text-xs text-slate-500">Sampled</p><p className="mt-2 text-2xl font-bold">{mockWorkspaceCase.sampled}</p></div>
              <div className="rounded-2xl bg-white/45 p-4"><p className="text-xs text-slate-500">Buildings</p><p className="mt-2 text-2xl font-bold">{mockWorkspaceCase.buildings}</p></div>
            </div>
            <div className="mt-6 rounded-2xl border border-white/40 bg-white/35 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Reviewer note</p>
              <Textarea className="mt-3 min-h-[130px] resize-none rounded-2xl border-white/10 bg-white text-slate-950" placeholder="Write a review note for this listing case" />
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-[1.6rem] border border-white/70 bg-white/70 p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">QC findings</p>
              <div className="mt-4 grid gap-3">
                {mockWorkspaceCase.issues.map((issue) => (
                  <div key={issue.label} className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-950">{issue.label}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{issue.detail}</p>
                      </div>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{issue.severity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-white/70 bg-white/70 p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">Field record summary</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["Interviewer", mockWorkspaceCase.interviewer],
                  ["Current status", formatToken(mockWorkspaceCase.status)],
                  ["Sampling rate", `${Math.round((mockWorkspaceCase.sampled / mockWorkspaceCase.households) * 100)}%`],
                  ["Open flags", mockWorkspaceCase.issues.length],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                    <p className="mt-1 font-semibold text-slate-950">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </PlatformPage>
  );

  async function loadDetail() {
    setMessage(null);
    const payload = await apiFetch<ListingCaseDetail>(`/api/listing/cases/${encodeURIComponent(submissionKey)}`, {}, token);
    setDetail(payload);
    setEaFeature((payload.eaFeature as Record<string, unknown> | null | undefined) ?? null);
    if (typeof payload.case.approval_status === "string") setStatus(payload.case.approval_status);
  }

  useEffect(() => {
    void loadDetail();
  }, [submissionKey, token]);

  const queueSubmissionKeysFromState = useMemo(() => {
    const state = location.state as { queueSubmissionKeys?: unknown } | null;
    return Array.isArray(state?.queueSubmissionKeys)
      ? state.queueSubmissionKeys.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
  }, [location.state]);

  useEffect(() => {
    if (queueSubmissionKeysFromState.length > 0) {
      setFallbackQueueSubmissionKeys([]);
      return;
    }

    let cancelled = false;

    async function loadQueueFallback() {
      const query = location.search.startsWith("?") ? location.search : "";
      const payload = await apiFetch<{ items: CaseListItem[] }>(`/api/listing/cases${query}`, {}, token);
      if (!cancelled) {
        setFallbackQueueSubmissionKeys(payload.items.map((item) => item.submission_key));
      }
    }

    void loadQueueFallback();

    return () => {
      cancelled = true;
    };
  }, [location.search, queueSubmissionKeysFromState, token]);

  async function submitStatus() {
    await apiFetch(
      `/api/listing/cases/${encodeURIComponent(submissionKey)}/status`,
      {
        method: "POST",
        body: JSON.stringify({ status, note: statusNote }),
      },
      token,
    );
    setMessage("Case status updated.");
    await loadDetail();
  }

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    if (!correction.issueId || !correction.tableName || !correction.fieldName) return;
    await apiFetch(
      "/api/listing/corrections",
      {
        method: "POST",
        body: JSON.stringify({
          submissionKey,
          caseId: correction.caseId || null,
          issueId: correction.issueId,
          tableName: correction.tableName,
          rowIdentifier: correction.rowIdentifier || null,
          fieldName: correction.fieldName,
          proposedValue: correction.proposedValue,
          reason: correction.reason,
        }),
      },
      token,
    );
    setMessage("Correction applied.");
    setCorrection({
      issueId: "",
      caseId: "",
      caseLabel: "",
      issueSummary: "",
      tableName: "",
      rowIdentifier: "",
      fieldName: "",
      currentValue: "",
      proposedValue: "",
      reason: "",
    });
    await loadDetail();
  }

  async function reviewCorrection(changeId: string, decision: "approved" | "rejected") {
    await apiFetch(
      `/api/listing/corrections/${changeId}/review`,
      {
        method: "POST",
        body: JSON.stringify({ decision }),
      },
      token,
    );
    setMessage(`Correction ${decision}.`);
    await loadDetail();
  }

  const currentUserRole = user?.role ?? "";
  const canEdit = Boolean(currentUserRole);
  const canDecide = canEdit;

  const caseData = useMemo(() => ((detail?.case ?? {}) as Record<string, unknown>), [detail?.case]);

  const snapshotGpsPoints = useMemo<GpsPoint[]>(
    () =>
      (detail?.listingRows ?? [])
        .filter((r) => r.gps_lat != null && r.gps_long != null)
        .map((r) => ({
          lat: r.gps_lat as number,
          lng: r.gps_long as number,
          rowType: r.row_type,
          sampleFlag: r.sample_flag,
          sampleStatus: String((r.record ?? {})["sample_status"] ?? "").trim() || null,
        })),
    [detail?.listingRows],
  );
  const filteredSnapshotGpsPoints = useMemo(
    () =>
      snapshotGpsPoints.filter((point) =>
        shouldShowSnapshotPoint(point, showNonResidential, selectedSampleStatuses),
      ),
    [selectedSampleStatuses, showNonResidential, snapshotGpsPoints],
  );
  const caseRecord = ((caseData.record ?? {}) as Record<string, unknown>) ?? {};
  const caseStatus = String(caseData.approval_status ?? "-");
  const finalReviewerName = useMemo(() => {
    const match = [...(detail?.history ?? [])].reverse().find(
      (h) => h.new_status === caseStatus,
    );
    return match?.changed_by_name ?? match?.changed_by_email ?? null;
  }, [detail?.history, caseStatus]);
  const correctableIssues = useMemo(
    () =>
      (detail?.issues ?? []).filter(
        (issue) => Boolean(issue.issue_id && issue.table_name && issue.field_name),
      ),
    [detail?.issues],
  );
  const queueSubmissionKeys = queueSubmissionKeysFromState.length > 0 ? queueSubmissionKeysFromState : fallbackQueueSubmissionKeys;
  const currentQueueIndex = queueSubmissionKeys.findIndex((key) => key === submissionKey);
  const previousSubmissionKey = currentQueueIndex > 0 ? queueSubmissionKeys[currentQueueIndex - 1] : null;
  const nextSubmissionKey =
    currentQueueIndex >= 0 && currentQueueIndex < queueSubmissionKeys.length - 1 ? queueSubmissionKeys[currentQueueIndex + 1] : null;
  const queuePositionText =
    currentQueueIndex >= 0 && queueSubmissionKeys.length > 0 ? `${currentQueueIndex + 1} of ${queueSubmissionKeys.length}` : null;

  function goToSubmission(targetSubmissionKey: string | null) {
    if (!targetSubmissionKey) return;

    window.scrollTo({ top: 0, behavior: "smooth" });

    navigate(
      {
        pathname: `/listing/cases/${encodeURIComponent(targetSubmissionKey)}`,
        search: location.search,
      },
      {
        state: queueSubmissionKeys.length > 0 ? { queueSubmissionKeys } : undefined,
      },
    );
  }

  function setCorrectionFromIssue(issueId: string) {
    const issue = correctableIssues.find((candidate) => candidate.issue_id === issueId);
    if (!issue) {
      setCorrection({
        issueId: "",
        caseId: "",
        caseLabel: "",
        issueSummary: "",
        tableName: "",
        rowIdentifier: "",
        fieldName: "",
        currentValue: "",
        proposedValue: "",
        reason: "",
      });
      return;
    }

    setCorrection({
      issueId: issue.issue_id,
      caseId: issue.case_id ?? "",
      caseLabel: issue.case_label ?? "",
      issueSummary: issue.issue_summary,
      tableName: issue.table_name ?? "",
      rowIdentifier: issue.row_identifier ?? "",
      fieldName: issue.field_name ?? "",
      currentValue: issue.current_value ?? "",
      proposedValue: "",
      reason: "",
    });
  }

  useEffect(() => {
    if (!correction.issueId) return;
    if (!correctableIssues.some((issue) => issue.issue_id === correction.issueId)) {
      setCorrectionFromIssue("");
    }
  }, [correction.issueId, correctableIssues]);

  return (
    <PlatformPage
      title="Listing Case Review Workspace"
      subtitle=""
      syncLabel=""
      module={module}
    >
      <div className="space-y-6">
        {/* Back to Review Queue */}
        <div className="flex items-center gap-3">
          <Link
            to={`/listing/cases${location.search}`}
            className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/44 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white/60"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Review Queue
          </Link>
        </div>

        <section className="glass-panel-strong overflow-hidden p-6">
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            {/* Column 1: EA info + snapshot + KPI cards */}
            <div className="flex flex-col gap-6">
              {/* Header and EA Snapshot row */}
              <div className="flex flex-col sm:flex-row gap-5 items-start justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`border text-[11px] font-semibold ${statusBadgeClass(caseStatus)}`}>
                      {formatToken(caseStatus)}
                    </Badge>
                    <span className="executive-chip border-sky-500/20 bg-sky-500/10 text-sky-700">
                      Detailed review
                    </span>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <h2 className="text-3xl font-semibold text-slate-900">{String(caseRecord.ea_name ?? submissionKey)}</h2>
                    <CaseStatusBadge status={caseStatus} reviewerName={finalReviewerName} />
                  </div>
                  <p className="mt-3 max-w-sm text-sm leading-7 text-slate-600">
                    Use this workspace to inspect generated QC findings, move the case through the controlled review lifecycle, and keep every change traceable.
                  </p>
                </div>

                {/* EA snapshot */}
                <div
                  className="group relative w-full sm:w-[340px] shrink-0 flex cursor-pointer flex-col overflow-hidden rounded-[1.8rem] border border-white/70 bg-white/30 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                  onClick={() => setMapModalOpen(true)}
                  title="Click to expand Ward map"
                >
                  <div className="flex items-center justify-between px-4 py-2">
                    <div className="flex items-center gap-2">
                      <MapPinned className="h-4 w-4 text-primary" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Ward snapshot</p>
                    </div>
                    <Maximize2 className="h-4 w-4 text-slate-400 transition group-hover:text-primary" />
                  </div>
                  <div className="h-[140px]">
                    <MapContainer
                      key={eaFeature ? String((((eaFeature as Record<string, unknown>).properties ?? {}) as Record<string, unknown>).sd_EA_ID ?? "ea") : "loading"}
                      center={NIGERIA_CENTER}
                      zoom={6}
                      scrollWheelZoom={false}
                      zoomControl={false}
                      attributionControl={false}
                      className="h-full w-full pointer-events-none"
                    >
                      <SnapshotFitController feature={eaFeature} />
                      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                      {eaFeature ? (
                        <GeoJSON
                          data={eaFeature as unknown as GeoJsonObject}
                          style={{ color: "#3b82f6", weight: 2.4, fillColor: "#93c5fd", fillOpacity: 0.22 }}
                        />
                      ) : null}
                      {filteredSnapshotGpsPoints.map((pt, i) => (
                        <SnapshotPointMarker key={`snapshot-${i}`} point={pt} index={i} />
                      ))}
                    </MapContainer>
                  </div>
                  <div className="px-4 py-1.5 text-[11px] text-slate-500">
                    {snapshotGpsPoints.length} GPS points · click to expand
                  </div>
                </div>
              </div>

              {/* KPI cards in shared 3-col grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* KPI cards row */}
                <SummaryCard label="Listing Entries" value={detail?.listingRows.length ?? 0} note="Household and structure rows recorded in this submission." />
                <SummaryCard label="Sample Selections" value={detail?.selectedRows.length ?? 0} note="Selected households available for sample verification." />
                <SummaryCard label="Active QC Issues" value={detail?.issues.length ?? 0} note="QC findings generated for reviewer follow-up and resolution." />
              </div>
            </div>

            {/* Column 2: Workflow control */}
            <div className="glass-panel rounded-[1.8rem] p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl bg-primary/12 p-3 text-primary">
                    <ClipboardPenLine className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Workflow control</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">Move the case through review</h3>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Next status</label>
                    <select className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="submitted">Submitted</option>
                      <option value="pending_review">Pending Review</option>
                      <option value="in_review">In Review</option>
                      <option value="corrected">Corrected</option>
                      {canDecide ? <option value="approved">Approved</option> : null}
                      {canDecide ? <option value="rejected">Rejected</option> : null}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Workflow note</label>
                    <Input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} className={INPUT_CLASS} placeholder="Document the reason for this change" />
                  </div>
                  <Button type="button" onClick={() => void submitStatus()} disabled={!canEdit} className="h-11 w-full rounded-2xl text-sm">
                    Update case status
                  </Button>
                  {message ? <p className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-xs text-primary">{message}</p> : null}
                </div>
              </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card className="glass-panel rounded-[1.8rem] border-white/70">
            <CardContent className="p-6">
              <div className="mb-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Case identity</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Submission metadata</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <MetricLine label="Submission" value={submissionKey} />
                <MetricLine label="Ward ID" value={String(caseData.ea_id ?? "-")} />
                <MetricLine label="LGA" value={String(caseRecord.lga_name ?? "-")} />
                <MetricLine label="State" value={String(caseRecord.state_name ?? "-")} />
                <MetricLine label="Interviewer" value={String(caseData.interviewer_id ?? "-")} />
                <MetricLine label="Supervisor" value={String(caseData.supervisor_id ?? "-")} />
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel rounded-[1.8rem] border-white/70">
            <CardContent className="p-6">
              <div className="mb-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Review context</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Operational signals around this case</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <MetricLine label="Current status" value={formatToken(caseStatus)} />
                <MetricLine label="Pending changes" value={detail?.pendingChanges.length ?? 0} />
                <MetricLine label="History events" value={detail?.history.length ?? 0} />
                <MetricLine label="Generated issues" value={detail?.issues.length ?? 0} />
              </div>
            </CardContent>
          </Card>
        </section>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReviewTab)} className="space-y-4">
          <TabsList className="h-auto rounded-2xl p-1">
            {(["issues", "correction", "changes", "history"] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-2xl px-4 py-2 text-sm text-slate-500 data-[state=active]:shadow-none"
              >
                {{ issues: "QC Issues", correction: "Submit Correction", changes: "Pending Changes", history: "Timeline" }[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="issues">
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="space-y-3 p-6">
                <div className="mb-2 flex items-center gap-3">
                  <div className="rounded-2xl bg-rose-500/10 p-3 text-rose-700">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Generated findings</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">Rule-based QC issues to review</h3>
                  </div>
                </div>

                {detail?.issues.length ? (
                  (detail?.issues ?? []).map((issue) => {
                    const severityBorder: Record<string, string> = {
                      critical: "border-l-rose-500",
                      high: "border-l-orange-400",
                      medium: "border-l-amber-400",
                      low: "border-l-sky-400",
                    };
                    const severityText: Record<string, string> = {
                      critical: "text-rose-700 bg-rose-500/10 border-rose-500/25",
                      high: "text-orange-700 bg-orange-500/10 border-orange-500/25",
                      medium: "text-amber-700 bg-amber-500/10 border-amber-500/25",
                      low: "text-sky-700 bg-sky-500/10 border-sky-500/25",
                    };
                    const sev = (issue.severity ?? "low").toLowerCase();
                    const borderClass = severityBorder[sev] ?? "border-l-slate-300";
                    const sevBadgeClass = severityText[sev] ?? "text-slate-700 bg-white/45 border-slate-300";

                    return (
                      <div key={issue.issue_id} className={`glass-inset rounded-[1.4rem] border-l-4 ${borderClass} px-5 py-4`}>
                        {/* Header row */}
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="text-sm font-semibold leading-6 text-slate-900">{issue.issue_summary}</p>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {issue.severity ? (
                              <Badge variant="outline" className={`border text-[11px] font-semibold ${sevBadgeClass}`}>
                                {formatToken(issue.severity)}
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className={`border text-[11px] ${statusBadgeClass(issue.issue_status)}`}>
                              {formatToken(issue.issue_status)}
                            </Badge>
                          </div>
                        </div>

                        {/* Detail pills */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {issue.case_label ? (
                            <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/50 px-3 py-1 text-xs text-slate-600">
                              <span className="font-medium text-slate-400">Household</span>
                              {issue.case_label}
                            </span>
                          ) : null}
                          {issue.field_name ? (
                            <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/50 px-3 py-1 text-xs text-slate-600">
                              <span className="font-medium text-slate-400">Variable</span>
                              {issue.field_name}
                            </span>
                          ) : null}
                          {issue.variable_label ? (
                            <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/50 px-3 py-1 text-xs text-slate-600">
                              <span className="font-medium text-slate-400">Variable label</span>
                              {issue.variable_label}
                            </span>
                          ) : null}
                          {issue.current_value ? (
                            <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/50 px-3 py-1 text-xs text-slate-600">
                              <span className="font-medium text-slate-400">Value found</span>
                              {issue.current_value}
                            </span>
                          ) : null}
                          {issue.rule_code ? (
                            <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/50 px-3 py-1 text-xs font-mono text-slate-500">
                              {issue.rule_code}
                            </span>
                          ) : null}
                        </div>
                        {issue.matching_case_keys?.length ? (
                          <p className="mt-3 rounded-xl border border-violet-200/70 bg-violet-50/60 px-3 py-2 text-xs leading-5 text-violet-800">
                            <span className="font-semibold">Matching case IDs/keys: </span>
                            {issue.matching_case_keys.join(", ")}
                          </p>
                        ) : null}
                        {issue.rule_code && LISTING_RULE_DEFINITIONS[issue.rule_code] ? (
                          <p className="mt-3 rounded-xl border border-sky-200/70 bg-sky-50/60 px-3 py-2 text-xs leading-5 text-sky-800">
                            <span className="font-semibold">Definition: </span>
                            {LISTING_RULE_DEFINITIONS[issue.rule_code]}
                          </p>
                        ) : null}

                        {/* Resolution note */}
                        {issue.resolution_note ? (
                          <p className="mt-3 rounded-xl bg-emerald-500/8 px-3 py-2 text-xs leading-5 text-emerald-800">
                            <span className="font-semibold">Resolution: </span>{issue.resolution_note}
                          </p>
                        ) : null}

                        {/* Footer */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-400">Detected {formatDate(issue.created_at)}</p>
                          {canEdit && issue.table_name && issue.field_name ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setCorrectionFromIssue(issue.issue_id);
                                setActiveTab("correction");
                              }}
                              className="h-8 rounded-xl px-3 text-xs"
                            >
                              Submit Correction
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <EmptyState title="No QC issues" message="This case currently has no generated listing QC findings." />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="changes">
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="space-y-3 p-6">
                <div className="mb-2 flex items-center gap-3">
                  <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-700">
                    <CheckCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Review decisions</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">Corrections requiring reviewer decision</h3>
                  </div>
                </div>

                {detail?.pendingChanges.length ? (
                  (detail?.pendingChanges ?? []).map((change) => (
                    <div key={change.change_id} className="glass-inset rounded-[1.4rem] px-4 py-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-900">{change.field_name}</p>
                          <p className="text-xs text-slate-500">
                            {change.case_id ? `Case ${change.case_id}` : "Submission-level correction"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {String(change.current_value ?? "null")} to {String(change.proposed_value ?? "null")}
                          </p>
                          <p className="pt-1 text-sm leading-6 text-slate-600">{change.change_reason}</p>
                          {change.requested_by_name ? (
                            <p className="text-xs text-slate-500">
                              Requested by {change.requested_by_name}
                              {change.requested_device_id ? ` on ${change.requested_device_id}` : ""}
                            </p>
                          ) : null}
                          {change.reviewed_by_name ? (
                            <p className="text-xs text-slate-500">
                              Reviewed by {change.reviewed_by_name}
                              {change.reviewed_device_id ? ` on ${change.reviewed_device_id}` : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`border text-[11px] ${statusBadgeClass(change.change_status)}`}>
                            {formatToken(change.change_status)}
                          </Badge>
                          {canDecide && change.change_status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => void reviewCorrection(change.change_id, "approved")}
                                className="h-8 rounded-xl border border-emerald-500/25 bg-emerald-500/12 text-xs text-emerald-700 hover:bg-emerald-500/20"
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void reviewCorrection(change.change_id, "rejected")}
                                className="h-8 rounded-xl border-rose-500/25 bg-rose-500/10 text-xs text-rose-700 hover:bg-rose-500/20"
                              >
                                Reject
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No pending changes" message="No correction request is currently waiting for review." />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="space-y-3 p-6">
                <div className="mb-2 flex items-center gap-3">
                  <div className="rounded-2xl bg-sky-500/10 p-3 text-sky-700">
                    <History className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Audit timeline</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">Status and reviewer history</h3>
                  </div>
                </div>

                {detail?.history.length ? (
                  (detail?.history ?? []).map((item) => (
                    <div key={item.status_history_id} className="glass-inset rounded-[1.4rem] px-4 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{formatToken(item.new_status)}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{item.change_note || "No note recorded."}</p>
                          {item.changed_by_name || item.changed_by_email ? (
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              By {item.changed_by_name ?? item.changed_by_email}
                            </p>
                          ) : null}
                          {item.device_id ? (
                            <p className="mt-1 text-xs leading-5 text-slate-500">Device: {item.device_id}</p>
                          ) : null}
                        </div>
                        <span className="text-xs text-slate-500">{formatDate(item.changed_at)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No history yet" message="Case status changes will appear here as reviewers work through the submission." />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="correction">
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="p-6">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-700">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Correction proposal</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">Submit a traceable change request</h3>
                  </div>
                </div>

                {canEdit ? (
                  <form className="grid gap-4 md:grid-cols-2" onSubmit={submitCorrection}>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Flagged case</label>
                      <select
                        className={SELECT_CLASS}
                        value={correction.issueId}
                        onChange={(e) => setCorrectionFromIssue(e.target.value)}
                      >
                        <option value="">Select a flagged case</option>
                        {correctableIssues.map((issue) => (
                          <option key={issue.issue_id} value={issue.issue_id}>
                            {buildIssueOptionLabel(issue)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Case</label>
                      <Input className={INPUT_CLASS} value={correction.caseLabel || correction.caseId} readOnly />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Variable</label>
                      <Input className={INPUT_CLASS} value={correction.fieldName} readOnly />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Current value</label>
                      <Input className={INPUT_CLASS} value={correction.currentValue} readOnly />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Issue</label>
                      <Input className={INPUT_CLASS} value={correction.issueSummary} readOnly />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">New proposed value</label>
                      <Input
                        className={INPUT_CLASS}
                        value={correction.proposedValue}
                        onChange={(e) => setCorrection({ ...correction, proposedValue: e.target.value })}
                        placeholder="Enter the corrected value"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Reason</label>
                      <Textarea
                        value={correction.reason}
                        onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
                        className="min-h-[120px] resize-none rounded-2xl"
                        rows={4}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Button type="submit" disabled={!correction.issueId || !correction.proposedValue.trim() || !correction.reason.trim()} className="h-11 rounded-2xl text-sm">
                        Apply correction
                      </Button>
                    </div>
                  </form>
                ) : (
                  <EmptyState title="Read-only access" message="Your current role cannot submit a correction request." />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <section className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="flex justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => goToSubmission(previousSubmissionKey)}
              disabled={!previousSubmissionKey}
              className="h-10 rounded-2xl border-white/70 bg-white/44 px-4 text-sm text-slate-900 hover:bg-white/60"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>

          <div className="flex justify-center">
            {queuePositionText ? (
              <span className="executive-chip border-slate-300/60 bg-white/60 text-slate-700">Ward {queuePositionText}</span>
            ) : null}
          </div>

          <div className="flex justify-start md:justify-end">
            <Button
              type="button"
              onClick={() => goToSubmission(nextSubmissionKey)}
              disabled={!nextSubmissionKey}
              className="h-10 rounded-2xl px-4 text-sm"
            >
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>
      </div>

      {/* EA map modal */}
      {mapModalOpen ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={() => setMapModalOpen(false)}
        >
          <div
            className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <MapPinned className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Ward coverage snapshot</p>
                  <h3 className="mt-0.5 text-lg font-semibold text-slate-900">
                    {String(((detail?.case ?? {}) as Record<string, unknown>).record
                      ? (((detail?.case ?? {}) as Record<string, unknown>).record as Record<string, unknown>).ea_name ?? submissionKey
                      : submissionKey)}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMapModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/70 bg-white/50 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Map */}
            <div className="h-[65vh] w-full">
              <MapContainer
                center={NIGERIA_CENTER}
                zoom={6}
                scrollWheelZoom
                zoomControl
                attributionControl={false}
                className="h-full w-full"
              >
                <SnapshotFitController feature={eaFeature} />
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                {eaFeature ? (
                  <GeoJSON
                    data={eaFeature as unknown as GeoJsonObject}
                    style={{ color: "#3b82f6", weight: 2.8, fillColor: "#93c5fd", fillOpacity: 0.2 }}
                  />
                ) : null}
                {filteredSnapshotGpsPoints.map((pt, i) => (
                  <SnapshotPointMarker key={`modal-${i}`} point={pt} index={i} />
                ))}
              </MapContainer>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 bg-blue-500" />
                Household GPS
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-red-700 bg-red-500" />
                Non-residential GPS
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center text-[15px] leading-none text-yellow-400" style={{ textShadow: "0 0 1px #854d0e" }}>★</span>
                Sampled household GPS
              </div>
              <label className="ml-2 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/50 px-3 py-1.5 text-xs font-medium text-slate-700">
                <span>Non-residential</span>
                <button
                  type="button"
                  onClick={() => setShowNonResidential((current) => !current)}
                  className={showNonResidential ? "rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"}
                >
                  {showNonResidential ? "On" : "Off"}
                </button>
              </label>
              <div className="flex flex-wrap items-center gap-2 rounded-[1rem] border border-white/70 bg-white/50 px-3 py-1.5 text-slate-700">
                <span className="font-medium text-slate-600">Sample status</span>
                {SAMPLE_STATUS_OPTIONS.map((option) => (
                  <label key={option} className="inline-flex items-center gap-1.5">
                    <Checkbox
                      checked={selectedSampleStatuses.includes(option)}
                      onCheckedChange={(checked) =>
                        setSelectedSampleStatuses((current) =>
                          checked
                            ? current.includes(option)
                              ? current
                              : [...current, option]
                            : current.filter((value) => value !== option),
                        )
                      }
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              <span className="ml-auto">
                {filteredSnapshotGpsPoints.length === snapshotGpsPoints.length
                  ? `${snapshotGpsPoints.length} GPS points recorded`
                  : `${filteredSnapshotGpsPoints.length} of ${snapshotGpsPoints.length} GPS points recorded`}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </PlatformPage>
  );
}
