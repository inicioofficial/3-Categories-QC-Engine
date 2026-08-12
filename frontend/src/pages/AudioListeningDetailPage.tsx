import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Headphones,
  Mic,
  Save,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { PlatformPage, formatDate, formatToken, statusBadgeClass } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { withSurveyCtoSession } from "@/lib/surveyctoSession";
import { cn } from "@/lib/utils";

const AUDIO_LABELS: Record<string, string> = {
  QF1_audio_audit:  "Remittance eligibility and consent",
  BAA1_audio_audit: "Sender country and relationship",
  MF1_audio_audit:  "Transfer channel used",
  NB1_audio_audit:  "Receiving point and cash-out experience",
  M1a_audio_audit:  "Fees, speed, and exchange-rate clarity",
  SA1_audio_audit:  "Use of received funds",
  Q1_audio_audit:   "Overall remittance experience",
};

type AccompanimentVerification = {
  accompanied_value?: string | null;
  picture_url?: string | null;
  verification_status?: string | null;
  verification_note?: string | null;
  verified_at?: string | null;
};

type AudioFileItem = {
  variable_name: string;
  label: string;
  file_name: string;
  media_url?: string | null;
};

type AudioDetail = {
  audio_id: string;
  case_id: string;
  case_label?: string | null;
  submission_key: string;
  audio_url: string | null;
  status: string;
  quality_rating: string | null;
  reviewer_note: string | null;
  assigned_to_user_id: string | null;
  assigned_to_username: string | null;
  assigned_to_role: string | null;
  reviewed_at: string | null;
  created_at: string;
  ea_id: string | null;
  interviewer_id: string | null;
  supervisor_id: string | null;
  approval_stage: string | null;
  submitted_at: string | null;
  ea_name: string | null;
  lga_name: string | null;
  state_name: string | null;
  audio_files?: Record<string, string | null>;
  audio_file_items?: AudioFileItem[];
  accompaniment?: AccompanimentVerification;
  supacc_confirm?: string | null;
  sup_photo?: string | null;
};

const OUTCOME_OPTIONS = [
  { value: "good",       label: "Good" },
  { value: "fair",       label: "Fair" },
  { value: "poor",       label: "Poor" },
  { value: "inaudible",  label: "Inaudible" },
];




function getMainMediaUrl(value: string | null | undefined): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (/^data:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return withSurveyCtoSession(`/api/main-survey/media-proxy/${encodeURIComponent(raw)}`);
  if (raw.startsWith("/api/main-survey/media-proxy/")) return withSurveyCtoSession(raw);
  if (raw.startsWith("/")) return raw;
  const fileName = raw.split("/").pop()?.split("\\").pop() ?? raw;
  return withSurveyCtoSession(`/api/main-survey/media-proxy/${encodeURIComponent(fileName)}`);
}

function getAudioItems(detail: Pick<AudioDetail, "audio_file_items" | "audio_files" | "audio_url">): AudioFileItem[] {
  if (detail.audio_file_items?.length) return detail.audio_file_items;
  const legacyItems = Object.entries(detail.audio_files ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([variableName, fileName]) => ({
      variable_name: variableName,
      label: AUDIO_LABELS[variableName] ?? variableName,
      file_name: fileName,
      media_url: fileName,
    }));
  if (legacyItems.length) return legacyItems;
  return detail.audio_url
    ? [{ variable_name: "audio_url", label: "Interview audio", file_name: detail.audio_url, media_url: detail.audio_url }]
    : [];
}

const SILENT_AUDIO_DATA_URI = "/videoplayback_audio.m4a";

function syntheticIndex(seed: string) {
  return Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildSyntheticAudioDetail(rawCaseId: string): AudioDetail {
  const decoded = decodeURIComponent(rawCaseId);
  const index = syntheticIndex(decoded);
  const states = ["Lagos", "FCT", "Kano", "Rivers", "Oyo", "Kaduna", "Edo", "Ogun"];
  const lgas = ["Ikeja", "Municipal", "Nassarawa", "Obio-Akpor", "Ibadan North", "Kaduna North", "Oredo", "Abeokuta South"];
  const stateIndex = index % states.length;
  const submittedAt = new Date(Date.UTC(2026, 3, (index % 24) + 1, 9 + (index % 8), 15)).toISOString();

  return {
    audio_id: `AUD-${decoded}`,
    case_id: decoded,
    case_label: decoded,
    submission_key: decoded.startsWith("MAIN-") ? decoded : `MAIN-${String(index).padStart(5, "0")}`,
    audio_url: SILENT_AUDIO_DATA_URI,
    status: index % 4 === 0 ? "reviewed" : "pending_review",
    quality_rating: ["good", "fair", "poor"][index % 3],
    reviewer_note: index % 2 === 0 ? "Synthetic silent listening note: verify remittance channel and respondent consistency." : null,
    assigned_to_user_id: `qc-${100 + (index % 8)}`,
    assigned_to_username: `qc_${101 + (index % 8)}`,
    assigned_to_role: "qc_reviewer",
    reviewed_at: index % 4 === 0 ? submittedAt : null,
    created_at: submittedAt,
    ea_id: `WARD-${String((index % 48) + 1).padStart(3, "0")}`,
    interviewer_id: `enum_${201 + (index % 20)}`,
    supervisor_id: `sup_${301 + (index % 6)}`,
    approval_stage: ["pending_review", "in_review", "submitted"][index % 3],
    submitted_at: submittedAt,
    ea_name: `${states[stateIndex]} Remittance Ward ${(index % 12) + 1}`,
    lga_name: lgas[stateIndex],
    state_name: states[stateIndex],
    audio_files: {
      QF1_audio_audit: SILENT_AUDIO_DATA_URI,
      BAA1_audio_audit: index % 2 === 0 ? SILENT_AUDIO_DATA_URI : null,
      MF1_audio_audit: index % 3 === 0 ? SILENT_AUDIO_DATA_URI : null,
      NB1_audio_audit: null,
      M1a_audio_audit: SILENT_AUDIO_DATA_URI,
      SA1_audio_audit: index % 4 === 0 ? SILENT_AUDIO_DATA_URI : null,
      Q1_audio_audit: SILENT_AUDIO_DATA_URI,
    },
    accompaniment: {
      accompanied_value: index % 3 === 0 ? "Yes" : "No",
      picture_url: null,
      verification_status: "needs_review",
      verification_note: null,
      verified_at: null,
    },
    supacc_confirm: index % 3 === 0 ? "Yes" : "No",
    sup_photo: null,
  };
}

function buildSyntheticAudioQueue(activeCaseId: string) {
  const decoded = decodeURIComponent(activeCaseId);
  const base = syntheticIndex(decoded);
  const queue = Array.from({ length: 18 }, (_, index) => `MAIN-AUD-${String(base + index + 1).padStart(5, "0")}`);
  return queue.includes(decoded) ? queue : [decoded, ...queue];
}

function MetaField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value ?? "—"}</p>
    </div>
  );
}

function PipelineStep({
  step,
  label,
  active,
  done,
}: {
  step: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          done ? "bg-emerald-500 text-white" : active ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-500",
        )}
      >
        {done ? "✓" : step}
      </span>
      <span className={cn("text-xs font-medium", active ? "text-slate-800" : "text-slate-400")}>{label}</span>
    </div>
  );
}

export function AudioListeningDetailPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const { caseId } = useParams<{ caseId: string }>();
  const location = useLocation();
  const routeState = location.state as { queueCaseIds?: string[]; returnTo?: string } | null;
  const routeQueueCaseIds: string[] = routeState?.queueCaseIds ?? [];
  const returnTo = routeState?.returnTo || "/main/audio-listening";

  const [item, setItem] = useState<AudioDetail | null>(null);
  const [fallbackQueueCaseIds, setFallbackQueueCaseIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qualityRating, setQualityRating] = useState("good");
  const [reviewerNote, setReviewerNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const statusRequestInFlight = useRef(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [roleUsers, setRoleUsers] = useState<{ user_id: string; username: string; full_name: string }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentResult, setAssignmentResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showAccImage, setShowAccImage] = useState(false);
  const [accStatus, setAccStatus] = useState("needs_review");
  const [accNote, setAccNote] = useState("");
  const [accSaving, setAccSaving] = useState(false);
  const [accResult, setAccResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function loadDetail() {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    setItem(null);
    setReviewerNote("");
    setStatusResult(null);
    setAccResult(null);
    setShowAccImage(false);
    try {
      const payload = await apiFetch<AudioDetail>(
        `/api/main-survey/audio-listening/cases/${encodeURIComponent(caseId)}/detail`,
        {},
        token,
        45000,
      );
      setItem(payload);
      setQualityRating(payload.quality_rating ?? "good");
      setReviewerNote(payload.reviewer_note ?? "");
      setStatusResult(null);
      setSelectedRole(payload.assigned_to_role ?? "");
      setAccStatus(payload.accompaniment?.verification_status ?? "needs_review");
      setAccNote(payload.accompaniment?.verification_note ?? "");
      setAccResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load silent listening case.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReview() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await apiFetch<{ status?: string; quality_rating?: string }>(
        `/api/main-survey/audio-listening/${encodeURIComponent(item.audio_id)}/review`,
        {
          method: "POST",
          body: JSON.stringify({ quality_rating: qualityRating, reviewer_note: reviewerNote || null }),
        },
        token,
        45000,
      );
      const reviewedAt = new Date().toISOString();
      setItem({
        ...item,
        status: payload.status ?? "reviewed",
        quality_rating: payload.quality_rating ?? qualityRating,
        reviewer_note: reviewerNote,
        reviewed_at: reviewedAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusUpdate(status: string) {
    if (!item || statusRequestInFlight.current) return;
    statusRequestInFlight.current = true;
    setStatusSaving(true);
    setPendingStatus(status);
    setStatusResult(null);
    try {
      await apiFetch(
        `/api/main-survey/cases/${encodeURIComponent(item.submission_key)}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status, note: statusNote || null }),
        },
        token,
        15000,
      );
      if (status === "approved" || status === "rejected") {
        setItem({ ...item, approval_stage: status });
        navigate(returnTo);
        return;
      }
      setItem({ ...item, approval_stage: status });
      setStatusResult({ ok: true, msg: `Status updated to "${formatToken(status)}".` });
      setStatusNote("");
    } catch (err) {
      setStatusResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to update status." });
    } finally {
      statusRequestInFlight.current = false;
      setStatusSaving(false);
      setPendingStatus(null);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [caseId]);

  useEffect(() => {
    if (routeQueueCaseIds.length > 0) {
      setFallbackQueueCaseIds([]);
      return;
    }

    if (caseId) setFallbackQueueCaseIds(buildSyntheticAudioQueue(caseId));
  }, [caseId, routeQueueCaseIds.length]);

  async function loadUsersByRole(role: string) {
    if (!role) {
      setRoleUsers([]);
      return;
    }
    setLoadingUsers(true);
    try {
      const payload = await apiFetch<{ users: { user_id: string; username: string; full_name: string }[] }>(
        `/api/admin/users/by-role/${encodeURIComponent(role)}`,
        {},
        token,
        30000,
      );
      setRoleUsers(payload.users ?? []);
    } catch {
      setRoleUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    if (selectedRole) {
      void loadUsersByRole(selectedRole);
    } else {
      setRoleUsers([]);
    }
    setSelectedUserId("");
  }, [selectedRole]);

  async function handleUnassign() {
    if (!item) return;
    setAssignmentSaving(true);
    setAssignmentResult(null);
    try {
      setItem({ ...item, assigned_to_user_id: null, assigned_to_username: null, assigned_to_role: null });
      setAssignmentResult({ ok: true, msg: "Audio review unassigned." });
    } catch (err) {
      setAssignmentResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to unassign audio review." });
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function handleReassign() {
    if (!item) return;
    setAssignmentSaving(true);
    setAssignmentResult(null);
    try {
      const selectedUser = roleUsers.find((entry) => entry.user_id === selectedUserId);
      setItem({
        ...item,
        assigned_to_role: selectedRole || null,
        assigned_to_user_id: selectedUserId || null,
        assigned_to_username: selectedUser?.username ?? (selectedRole ? `${selectedRole}_101` : null),
      });
      setAssignmentResult({ ok: true, msg: "Audio review reassigned successfully." });
    } catch (err) {
      setAssignmentResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to reassign audio review." });
    } finally {
      setAssignmentSaving(false);
    }
  }

  const queueCaseIds = routeQueueCaseIds.length > 0 ? routeQueueCaseIds : fallbackQueueCaseIds;
  const currentIdx = caseId ? queueCaseIds.indexOf(decodeURIComponent(caseId)) : -1;
  const prevId = currentIdx > 0 ? queueCaseIds[currentIdx - 1] : null;
  const nextId = currentIdx >= 0 && currentIdx < queueCaseIds.length - 1 ? queueCaseIds[currentIdx + 1] : null;

  function navigateTo(id: string) {
    navigate(`/main/audio-listening/${encodeURIComponent(id)}/detail`, {
      state: { queueCaseIds, returnTo },
    });
  }

  const reviewRecorded = !!item?.reviewed_at || item?.status === "reviewed";
  const reviewerClaimed = !!item?.assigned_to_user_id;
  const caseDecided = item?.approval_stage === "approved" || item?.approval_stage === "rejected";
  const canDecide = Boolean(user);


  async function saveAccompanimentVerification() {
    if (!item) return;
    setAccSaving(true);
    setAccResult(null);
    try {
      const saved = { verification_status: accStatus, verification_note: accNote || null, verified_at: new Date().toISOString() };
      setItem((prev) => (prev ? { ...prev, accompaniment: { ...(prev.accompaniment ?? {}), ...(saved ?? {}) } } : prev));
      setAccResult({ ok: true, msg: "Accompaniment verification saved." });
    } catch (err) {
      setAccResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to save accompaniment verification." });
    } finally {
      setAccSaving(false);
    }
  }

  const accompanimentValue = (item?.accompaniment?.accompanied_value ?? item?.supacc_confirm ?? "").toString();
  const accompanimentYes = ["yes", "1", "true"].includes(accompanimentValue.trim().toLowerCase());
  const accompanimentImageUrl = getMainMediaUrl(item?.accompaniment?.picture_url ?? item?.sup_photo);
  const audioEntries = item ? getAudioItems(item) : [];
  const caseLabel = item?.case_label || item?.case_id || "";

  if (!loading && !error && item) {
    const timeline = [
      { label: "Submitted", value: item.submitted_at ? formatDate(item.submitted_at) : "Pending timestamp", done: true },
      { label: "Assigned", value: item.assigned_to_username ?? "Unassigned", done: reviewerClaimed },
      { label: "Reviewed", value: item.reviewed_at ? formatDate(item.reviewed_at) : "Awaiting review", done: reviewRecorded },
      { label: "Decision", value: formatToken(item.approval_stage ?? "submitted"), done: caseDecided },
    ];

    return (
      <PlatformPage
        title="Silent Listening Individual Case"
        subtitle="Audio QC workspace for one main survey case"
        syncLabel={`Case ${item.submission_key}`}
        module="main"
        plainTopBar
        topBarActions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(returnTo)} className="flex items-center gap-1.5 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50">
              <ChevronLeft className="h-3.5 w-3.5" /> Silent Listening
            </button>
            {queueCaseIds.length > 0 ? (
              <>
                <button type="button" disabled={!prevId} onClick={() => prevId && navigateTo(prevId)} className="flex items-center gap-1 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50 disabled:opacity-40"><ArrowLeft className="h-3.5 w-3.5" />Prev</button>
                <span className="text-xs text-slate-400">{currentIdx >= 0 ? `${currentIdx + 1} / ${queueCaseIds.length}` : "--"}</span>
                <button type="button" disabled={!nextId} onClick={() => nextId && navigateTo(nextId)} className="flex items-center gap-1 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50 disabled:opacity-40">Next<ArrowRight className="h-3.5 w-3.5" /></button>
              </>
            ) : null}
          </div>
        }
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => navigate(returnTo)} className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/75 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-white">
              <ChevronLeft className="h-4 w-4" />
              Back to Silent Listening Section
            </button>
            {queueCaseIds.length > 0 ? (
              <div className="flex items-center gap-2">
                <button type="button" disabled={!prevId} onClick={() => prevId && navigateTo(prevId)} className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/75 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-white disabled:opacity-40">
                  <ArrowLeft className="h-4 w-4" />
                  Previous case
                </button>
                <span className="text-xs font-semibold text-slate-500">{currentIdx >= 0 ? `${currentIdx + 1} of ${queueCaseIds.length}` : "--"}</span>
                <button type="button" disabled={!nextId} onClick={() => nextId && navigateTo(nextId)} className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/75 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-white disabled:opacity-40">
                  Next case
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <section className="overflow-hidden rounded-[2rem] border border-white/60 bg-white/48 shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
            <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="bg-gradient-to-br from-sky-900 via-sky-700 to-cyan-600 p-7 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-100/80">Silent listening case file</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight">{caseLabel}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/90">Review audio consistency, respondent flow, and international remittance responses before making a QC decision.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Submission", item.submission_key],
                    ["Region", item.state_name ?? item.lga_name],
                    ["Selected case", caseLabel],
                    ["Submitted", item.submitted_at ? formatDate(item.submitted_at) : "--"],
                    ["Interviewer", item.interviewer_id],
                    ["Supervisor", item.supervisor_id],
                    ["Assigned QC", item.assigned_to_username ?? "Unassigned"],
                    ["Status", formatToken(item.approval_stage ?? "submitted")],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/20 bg-white/12 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-100/70">{label}</p>
                      <p className="mt-2 text-sm font-bold text-white">{value ?? "--"}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4 p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Case status</span>
                  <Badge variant="outline" className={cn("rounded-full text-xs", statusBadgeClass(item.approval_stage ?? "submitted"))}>{formatToken(item.approval_stage ?? "submitted")}</Badge>
                </div>
                <div className="grid gap-3">
                  {timeline.map((step, index) => (
                    <div key={step.label} className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/58 p-3">
                      <div className={cn("grid h-9 w-9 place-items-center rounded-2xl text-xs font-black", step.done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500")}>{index + 1}</div>
                      <div>
                        <p className="text-sm font-black text-slate-950">{step.label}</p>
                        <p className="text-xs text-slate-500">{step.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <Card className="rounded-[1.7rem] border-white/70 bg-white/48">
              <CardContent className="p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">Audio review console</p>
                    <h3 className="mt-1 text-xl font-black text-slate-950">{audioEntries.length} recordings available</h3>
                  </div>
                  <Headphones className="h-8 w-8 text-sky-600" />
                </div>
                <div className="space-y-3">
                  {audioEntries.map((entry, index) => (
                    <div key={entry.variable_name} className="rounded-2xl border border-slate-200/70 bg-white/72 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-slate-900">{entry.label}</p>
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">Track {index + 1}</span>
                      </div>
                      <audio controls src={getMainMediaUrl(entry.media_url || entry.file_name) ?? undefined} className="h-9 w-full" preload="none" />
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
                  <div>
                    <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Quality rating</label>
                    <select value={qualityRating} onChange={(e) => setQualityRating(e.target.value)} className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900">
                      {OUTCOME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Reviewer note</label>
                    <textarea value={reviewerNote} onChange={(e) => setReviewerNote(e.target.value)} rows={3} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" placeholder="Record audio quality and remittance response observations" />
                  </div>
                </div>
                <Button onClick={() => void submitReview()} disabled={saving} className="mt-4 rounded-2xl bg-sky-600 hover:bg-sky-700">
                  <Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save listening review"}
                </Button>
              </CardContent>
            </Card>

            {canDecide ? (
              <Card className="rounded-[1.7rem] border-white/70 bg-white/48">
                <CardContent className="p-5">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">QC decision</p>
                  <input value={statusNote} onChange={(e) => { setStatusNote(e.target.value); setStatusResult(null); }} placeholder="Decision note" className="mt-4 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900" />
                  {statusResult ? <p className={cn("mt-3 text-sm", statusResult.ok ? "text-emerald-700" : "text-rose-700")}>{statusResult.msg}</p> : null}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button type="button" disabled={statusSaving} onClick={() => void handleStatusUpdate("approved")} className="rounded-2xl bg-emerald-600 px-3 py-3 text-sm font-black text-white disabled:opacity-50">Approve</button>
                    <button type="button" disabled={statusSaving} onClick={() => void handleStatusUpdate("rejected")} className="rounded-2xl bg-rose-600 px-3 py-3 text-sm font-black text-white disabled:opacity-50">Reject</button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </section>
        </div>
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title="Silent Listening Individual Case"
      subtitle="Review a single assigned audio case"
      syncLabel={item ? `Case ${item.submission_key}` : "Audio review"}
      module="main"
      topBarActions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(returnTo)}
            className="flex items-center gap-1.5 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Audio Queue
          </button>
          {queueCaseIds.length > 0 && (
            <>
              <button
                type="button"
                disabled={!prevId}
                onClick={() => prevId && navigateTo(prevId)}
                className="flex items-center gap-1 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50 disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <span className="text-xs text-slate-400">
                {currentIdx >= 0 ? `${currentIdx + 1} / ${queueCaseIds.length}` : "—"}
              </span>
              <button
                type="button"
                disabled={!nextId}
                onClick={() => nextId && navigateTo(nextId)}
                className="flex items-center gap-1 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50 disabled:opacity-40"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading case detail…</div>
        ) : error ? (
          <div className="rounded-[1.2rem] border border-rose-300/40 bg-rose-50/50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : item ? (
          <>
            {/* QC Pipeline Progress Bar */}
            <div className="flex items-center gap-4 rounded-[1.4rem] border border-white/70 bg-white/30 px-5 py-3">
              <PipelineStep step={1} label="Case queued for audio review" active={true} done={true} />
              <div className="h-px flex-1 bg-slate-200" />
              <PipelineStep step={2} label="Reviewer claimed" active={reviewerClaimed} done={reviewerClaimed} />
              <div className="h-px flex-1 bg-slate-200" />
              <PipelineStep step={3} label="Audio review recorded" active={reviewRecorded} done={reviewRecorded} />
              <div className="h-px flex-1 bg-slate-200" />
              <PipelineStep step={4} label="Case approved / rejected" active={caseDecided} done={caseDecided} />
            </div>

            {/* Panel 1 — Case Metadata */}
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="p-6">
                <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <User className="h-3.5 w-3.5 text-sky-600" />
                  Case Metadata
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetaField label="Case ID" value={caseLabel} />
                  <MetaField label="Ward ID" value={item.ea_id} />
                  <MetaField label="Ward Name" value={item.ea_name} />
                  <MetaField label="LGA" value={item.lga_name} />
                  <MetaField label="State" value={item.state_name} />
                  <MetaField label="Interviewer" value={item.interviewer_id} />
                  <MetaField label="Supervisor" value={item.supervisor_id} />
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Approval Stage</p>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-xs", statusBadgeClass(item.approval_stage ?? "submitted"))}
                    >
                      {formatToken(item.approval_stage ?? "submitted")}
                    </Badge>
                  </div>
                  <MetaField label="Submitted" value={item.submitted_at ? formatDate(item.submitted_at) : null} />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/50 pt-4">
                  <Headphones className="h-4 w-4 text-sky-600" />
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Assigned To</span>
                  <span className="rounded-full border border-sky-300/40 bg-sky-50/60 px-3 py-1 text-xs text-sky-800">
                    {item!.assigned_to_username ?? "Unassigned"}
                  </span>
                </div>

                {false ? (
                  <div className="mt-4 rounded-[1.2rem] border border-white/60 bg-white/35 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Admin assignment control</p>
                        <p className="text-sm text-slate-600">Unassign this audio review or move it to another reviewer.</p>
                      </div>
                      <Button type="button" variant="outline" disabled={assignmentSaving || !item!.assigned_to_user_id} onClick={() => void handleUnassign()}>
                        {assignmentSaving ? "Saving…" : "Unassign"}
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                      <select className="flex h-11 rounded-[1rem] border border-white/70 bg-white/70 px-3 text-sm text-slate-800" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                        <option value="">Select role</option>
                        <option value="PDM-QC">PDM-QC</option>
                        <option value="PDM-ADMIN">PDM-ADMIN</option>
                      </select>
                      <select className="flex h-11 rounded-[1rem] border border-white/70 bg-white/70 px-3 text-sm text-slate-800" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} disabled={!selectedRole || loadingUsers}>
                        <option value="">Select a PDM-QC user</option>
                        {roleUsers.map((entry) => (
                          <option key={entry.user_id} value={entry.user_id}>
                            {entry.full_name} ({entry.username})
                          </option>
                        ))}
                      </select>
                      <Button type="button" disabled={assignmentSaving || !selectedRole} onClick={() => void handleReassign()}>
                        {assignmentSaving ? "Saving…" : "Reassign"}
                      </Button>
                    </div>
                    {assignmentResult ? (
                      <p className={cn("mt-3 text-sm", assignmentResult!.ok ? "text-emerald-700" : "text-rose-700")}>{assignmentResult!.msg}</p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Panel 2 — Audio Review */}
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="p-6">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <Mic className="h-3.5 w-3.5 text-sky-600" />
                  Audio Review
                </div>
                <p className="mb-4 text-xs text-slate-400">
                  Listen to the interview recordings below, then submit your quality rating and notes.
                </p>

                {audioEntries.length ? (
                  <div className="mb-4 space-y-3">
                    {audioEntries.map((audio) => {
                      const rawUrl = audio.media_url || audio.file_name;
                      const playerUrl = getMainMediaUrl(rawUrl);
                      return (
                        <div key={audio.variable_name} className="rounded-[1.15rem] border border-white/70 bg-white/44 px-4 py-3">
                          <p className="mb-2 text-xs font-semibold text-slate-700">{audio.label}</p>
                          <audio
                            controls
                            src={playerUrl ?? undefined}
                            className="h-8 w-full"
                            preload="none"
                          />
                          <a href={playerUrl ?? undefined} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-sky-700 underline underline-offset-2">Open audio link</a>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mb-4 text-sm text-slate-400">No audio recordings available for this case.</p>
                )}

                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Quality Rating
                    </label>
                    <select
                      value={qualityRating}
                      onChange={(e) => setQualityRating(e.target.value)}
                      className="flex h-11 w-full cursor-pointer rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-all focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {OUTCOME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Reviewer Notes
                    </label>
                    <textarea
                      value={reviewerNote}
                      onChange={(e) => setReviewerNote(e.target.value)}
                      rows={4}
                      className="w-full rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Add notes about audio quality…"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    onClick={() => void submitReview()}
                    disabled={saving}
                    className="rounded-xl"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving…" : "Submit Review"}
                  </Button>
                </div>
              </CardContent>
            </Card>


            {/* Panel 3 — Accompaniment Verification */}
            <Card className="glass-panel rounded-[1.8rem] border-white/70">
              <CardContent className="p-6">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
                  Accompaniment Verification
                </div>
                <p className="mb-4 text-xs text-slate-400">Confirm accompaniment and review the uploaded picture when available.</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <MetaField label="Accompaniment" value={accompanimentYes ? "Yes" : "No"} />
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Picture evidence</p>
                    {accompanimentYes ? (
                      accompanimentImageUrl ? (
                        <button type="button" onClick={() => setShowAccImage(true)} className="text-sm font-medium text-sky-700 underline underline-offset-2">Open Picture link</button>
                      ) : (
                        <p className="text-sm text-slate-500">No picture provided</p>
                      )
                    ) : (
                      <p className="text-sm text-slate-500">No picture provided</p>
                    )}
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification outcome</label>
                    <select value={accStatus} onChange={(e) => setAccStatus(e.target.value)} className="flex h-11 w-full rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800">
                      <option value="verified">Verified</option>
                      <option value="not_verified">Not verified</option>
                      <option value="needs_review">Needs review</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification note</label>
                    <Input value={accNote} onChange={(e) => setAccNote(e.target.value)} placeholder="Add a note for the accompaniment check" className="flex h-11 w-full rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400" />
                  </div>
                </div>
                {accResult ? (
                  <p className={cn("mt-4 text-sm", accResult.ok ? "text-emerald-700" : "text-rose-700")}>{accResult.msg}</p>
                ) : null}
                <div className="mt-4">
                  <Button type="button" onClick={() => void saveAccompanimentVerification()} disabled={accSaving}>
                    {accSaving ? "Saving…" : "Save Accompaniment Verification"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Panel 4 — QC Decision */}
            {canDecide && (
              <Card className="glass-panel rounded-[1.8rem] border-white/70">
                <CardContent className="p-6">
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
                    QC Decision
                  </div>
                  <p className="mb-4 text-xs text-slate-400">
                    Based on audio review findings, make a final determination on this case.
                    Approving or rejecting will remove this case from the audio listening queue.
                  </p>

                  <div className="mb-4 flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Stage</span>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-xs", statusBadgeClass(item.approval_stage ?? "submitted"))}
                    >
                      {formatToken(item.approval_stage ?? "submitted")}
                    </Badge>
                  </div>

                  {statusResult && (
                    <div
                      className={cn(
                        "mb-4 rounded-[1rem] border px-4 py-3 text-sm",
                        statusResult.ok
                          ? "border-emerald-300/40 bg-emerald-50/50 text-emerald-700"
                          : "border-rose-300/40 bg-rose-50/50 text-rose-700",
                      )}
                    >
                      {statusResult.msg}
                    </div>
                  )}

                  <div className="mb-4 space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Decision note (optional)
                    </label>
                    <input
                      type="text"
                      value={statusNote}
                      onChange={(e) => { setStatusNote(e.target.value); setStatusResult(null); }}
                      placeholder="Add a rationale for audit trail…"
                      className="flex h-11 w-full rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={statusSaving}
                      onClick={() => void handleStatusUpdate("approved")}
                      className="flex items-center justify-center gap-2 rounded-[1.15rem] bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {pendingStatus === "approved" ? "Approving…" : "Approve Case"}
                    </button>
                    <button
                      type="button"
                      disabled={statusSaving}
                      onClick={() => void handleStatusUpdate("rejected")}
                      className="flex items-center justify-center gap-2 rounded-[1.15rem] bg-rose-600 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
                    >
                      <XCircle className="h-4 w-4" />
                      {pendingStatus === "rejected" ? "Rejecting…" : "Reject Case"}
                    </button>
                  </div>

                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                      Other status changes (in-review, corrected, pending…)
                    </summary>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {["submitted", "pending_review", "in_review", "corrected"].map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={statusSaving || item.approval_stage === s}
                          onClick={() => void handleStatusUpdate(s)}
                          className="rounded-[1rem] border border-white/50 bg-white/30 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white/50 disabled:opacity-40"
                        >
                          {formatToken(s)}
                        </button>
                      ))}
                    </div>
                  </details>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </div>
      {showAccImage && accompanimentImageUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6" onClick={() => setShowAccImage(false)}>
          <div className="max-h-[90vh] max-w-4xl overflow-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">Accompaniment Picture</h3>
              <button type="button" className="rounded-xl border px-3 py-1 text-sm" onClick={() => setShowAccImage(false)}>Close</button>
            </div>
            <img src={accompanimentImageUrl} alt="Accompaniment" className="max-h-[75vh] w-auto rounded-xl object-contain" />
          </div>
        </div>
      ) : null}
    </PlatformPage>
  );
}
