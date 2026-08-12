import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Loader2,
  Lock,
  Mic,
  PhoneCall,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { useNavigate, useLocation, useParams } from "react-router-dom";

import { PlatformPage, formatDate, formatToken, statusBadgeClass } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { withSurveyCtoSession } from "@/lib/surveyctoSession";
import { cn } from "@/lib/utils";

const OUTCOME_OPTIONS = [
  { value: "completed",    label: "Completed — call made, respondent reached" },
  { value: "no_answer",    label: "No Answer — rang out / voicemail" },
  { value: "refused",      label: "Refused — declined to speak" },
  { value: "wrong_number", label: "Wrong Number — not the respondent" },
  { value: "rescheduled",  label: "Rescheduled — agreed a new time" },
  { value: "phone_switched_off",  label: "Phone switched off" },
  { value: "unreachable",  label: "Unreachable" }, 
  { value: "temporary_network_failure",  label: "Temporary Network Failure" }, 
];

const CALLBACK_OUTCOME_OPTIONS = [
  { value: "completed", label: "Respondent reachable - completed" },
  { value: "no_answer", label: "Respondent not reachable - no answer" },
  { value: "phone_switched_off", label: "Respondent not reachable - phone switched off" },
  { value: "unreachable", label: "Respondent not reachable - unreachable" },
  { value: "temporary_network_failure", label: "Respondent not reachable - network failure" },
  { value: "wrong_number", label: "Wrong number - not the respondent" },
  { value: "refused", label: "Respondent refused" },
  { value: "rescheduled", label: "Respondent rescheduled" },
];

const OUTCOME_BADGE: Record<string, string> = {
  pending:      "border-amber-500/30 bg-amber-500/12 text-amber-700",
  completed:    "border-emerald-500/30 bg-emerald-500/12 text-emerald-700",
  no_answer:    "border-slate-400/30 bg-slate-100/50 text-slate-600",
  refused:      "border-rose-500/30 bg-rose-500/12 text-rose-700",
  wrong_number: "border-orange-500/30 bg-orange-500/12 text-orange-700",
  rescheduled:  "border-sky-500/30 bg-sky-500/10 text-sky-700",
  phone_switched_off: "border-rose-500/30 bg-rose-500/12 text-rose-700",
  unreachable:  "border-slate-400/30 bg-slate-100/50 text-slate-600",
  temporary_network_failure:  "border-amber-500/30 bg-amber-500/12 text-amber-700"
};

const AUDIO_LABELS: Record<string, string> = {
  QF1_audio_audit:  "Remittance eligibility and consent",
  BAA1_audio_audit: "Sender country and relationship",
  MF1_audio_audit:  "Transfer channel used",
  NB1_audio_audit:  "Receiving point and cash-out experience",
  M1a_audio_audit:  "Fees, speed, and exchange-rate clarity",
  SA1_audio_audit:  "Use of received funds",
  Q1_audio_audit:   "Overall remittance experience",
};

interface CallbackAttempt {
  callback_id: string;
  attempt_no: number;
  outcome_code: string;
  outcome_note: string | null;
  sampled_flag: boolean;
  assigned_to_user_id: string | null;
  assigned_to_username: string | null;
  completed_at: string | null;
  created_at: string | null;
}

interface VerificationQuestion {
  position: number;
  section_name: string;
  variable_name: string;
  question_label: string;
  respondent_answer_label: string;
  callback_answer: string | null;
  is_correct: boolean | null;
  verified_at: string | null;
}

interface VerificationQuestionsResponse {
  questions: VerificationQuestion[];
  mode?: "qc" | "random";
  fallback?: boolean;
}

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

interface CallbackDetail {
  submission_key: string;
  case_id: string;
  case_label?: string | null;
  region_label?: string | null;
  region_respondent_ordinal?: number | null;
  ea_id: string | null;
  ea_name: string | null;
  lga_name: string | null;
  state_name: string | null;
  selected_panel_labels?: string | null;
  interviewer_id: string | null;
  supervisor_id: string | null;
  approval_stage: string;
  submitted_at: string | null;
  is_callback_required: boolean;
  respondent_name?: string | null;
  respondent_address?: string | null;
  phone_no: string | null;
  audio_files: Record<string, string | null>;
  audio_file_items?: AudioFileItem[];
  callback_history: CallbackAttempt[];
  verification_questions: VerificationQuestion[];
  accompaniment?: AccompanimentVerification;
  supacc_confirm?: string | null;
  sup_photo?: string | null;
}

const SILENT_AUDIO_DATA_URI = "/videoplayback_audio.m4a";

function syntheticIndex(seed: string) {
  return Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildSyntheticVerificationQuestions(seed: string, mode: "qc" | "random"): VerificationQuestion[] {
  const index = syntheticIndex(seed);
  const qcQuestions = [
    ["International Remittance Experience", "remittance_received_12m", "Have you received money from outside Nigeria in the last 12 months?", index % 3 === 0 ? "No" : "Yes"],
    ["Transfer Channel", "primary_remittance_channel", "Which channel did you mainly use to receive international remittance?", ["Bank account", "Mobile money wallet", "Money transfer operator", "Agent cash pickup"][index % 4]],
    ["Fees And Speed", "fee_perception", "How would you describe the charges paid to receive the transfer?", ["Affordable", "Somewhat high", "Very high", "Do not know"][index % 4]],
  ];
  const randomQuestions = [
    ["Respondent Profile", "age_band", "Please confirm your age band as recorded during the interview.", ["18 - 25 years", "26 - 35 years", "36 - 45 years"][index % 3]],
    ["Income", "income_band", "Please confirm the income band you selected during the interview.", ["N150,001 - N300,000", "N300,001 - N500,000", "N500,001 - N800,000"][index % 3]],
    ["Remittance Use", "remittance_use", "What was the main use of the most recent remittance received?", ["Household consumption", "School fees", "Business support", "Medical expenses"][index % 4]],
  ];

  return (mode === "qc" ? qcQuestions : randomQuestions).map(([section_name, variable_name, question_label, respondent_answer_label], questionIndex) => ({
    position: questionIndex + 1,
    section_name,
    variable_name,
    question_label,
    respondent_answer_label,
    callback_answer: null,
    is_correct: null,
    verified_at: null,
  }));
}

function buildSyntheticCallbackDetail(rawCaseId: string, questionMode: "qc" | "random" = "qc"): CallbackDetail {
  const decoded = decodeURIComponent(rawCaseId);
  const index = syntheticIndex(decoded);
  const states = ["Lagos", "FCT", "Kano", "Rivers", "Oyo", "Kaduna", "Edo", "Ogun"];
  const lgas = ["Ikeja", "Municipal", "Nassarawa", "Obio-Akpor", "Ibadan North", "Kaduna North", "Oredo", "Abeokuta South"];
  const stateIndex = index % states.length;
  const submittedAt = new Date(Date.UTC(2026, 3, (index % 24) + 1, 10 + (index % 7), 5)).toISOString();
  const attemptCreatedAt = new Date(Date.UTC(2026, 4, (index % 20) + 1, 9 + (index % 6), 30)).toISOString();

  return {
    submission_key: decoded.startsWith("MAIN-") ? decoded : `MAIN-${String(index).padStart(5, "0")}`,
    case_id: decoded,
    ea_id: `WARD-${String((index % 48) + 1).padStart(3, "0")}`,
    ea_name: `${states[stateIndex]} Remittance Ward ${(index % 12) + 1}`,
    lga_name: lgas[stateIndex],
    state_name: states[stateIndex],
    interviewer_id: `enum_${201 + (index % 20)}`,
    supervisor_id: `sup_${301 + (index % 6)}`,
    approval_stage: ["pending_review", "in_review", "submitted"][index % 3],
    submitted_at: submittedAt,
    is_callback_required: true,
    phone_no: `080${String(30000000 + index * 97).slice(0, 8)}`,
    audio_files: {
      QF1_audio_audit: SILENT_AUDIO_DATA_URI,
      BAA1_audio_audit: index % 2 === 0 ? SILENT_AUDIO_DATA_URI : null,
      MF1_audio_audit: null,
      NB1_audio_audit: null,
      M1a_audio_audit: SILENT_AUDIO_DATA_URI,
      SA1_audio_audit: index % 3 === 0 ? SILENT_AUDIO_DATA_URI : null,
      Q1_audio_audit: SILENT_AUDIO_DATA_URI,
    },
    callback_history: [
      {
        callback_id: `CB-${decoded}-1`,
        attempt_no: 1,
        outcome_code: "pending",
        outcome_note: null,
        sampled_flag: true,
        assigned_to_user_id: `qc-${101 + (index % 7)}`,
        assigned_to_username: `qc_${101 + (index % 7)}`,
        completed_at: null,
        created_at: attemptCreatedAt,
      },
    ],
    verification_questions: buildSyntheticVerificationQuestions(decoded, questionMode),
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

function MetaField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value ?? "—"}</p>
    </div>
  );
}

/** Pipeline step indicator */
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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

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

function getAudioItems(detail: Pick<CallbackDetail, "audio_file_items" | "audio_files">): AudioFileItem[] {
  if (detail.audio_file_items?.length) return detail.audio_file_items;
  return Object.entries(detail.audio_files ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([variableName, fileName]) => ({
      variable_name: variableName,
      label: AUDIO_LABELS[variableName] ?? variableName,
      file_name: fileName,
      media_url: fileName,
    }));
}

function buildSyntheticCallbackQueue(activeCaseId: string) {
  const decoded = decodeURIComponent(activeCaseId);
  const base = syntheticIndex(decoded);
  const queue = Array.from({ length: 18 }, (_, index) => `MS-${String(base + index + 1).padStart(5, "0")}`);
  return queue.includes(decoded) ? queue : [decoded, ...queue];
}

export function CallbackDetailPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const { caseId } = useParams<{ caseId: string }>();
  const location = useLocation();
  const routeState = location.state as { queueCaseIds?: string[]; returnTo?: string } | null;
  const routeQueueCaseIds: string[] = routeState?.queueCaseIds ?? [];
  const returnTo = routeState?.returnTo || "/main/callbacks";
  const [fallbackQueueCaseIds, setFallbackQueueCaseIds] = useState<string[]>([]);

  const [detail, setDetail] = useState<CallbackDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [outcomeCode, setOutcomeCode] = useState("completed");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusResult, setStatusResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [verificationQuestions, setVerificationQuestions] = useState<VerificationQuestion[]>([]);
  const [verificationAnswers, setVerificationAnswers] = useState<
    Record<number, { callbackAnswer: string; isCorrect: boolean | null }>
  >({});
  const [savingVerification, setSavingVerification] = useState<number | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [proceeded, setProceeded] = useState(false);
  const [questionMode, setQuestionMode] = useState<"qc" | "random">("qc");
  const [questionNotice, setQuestionNotice] = useState<string | null>(null);
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
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false);

  const queueCaseIds = routeQueueCaseIds.length > 0 ? routeQueueCaseIds : fallbackQueueCaseIds;
  const currentIdx = caseId ? queueCaseIds.indexOf(decodeURIComponent(caseId)) : -1;
  const prevId = currentIdx > 0 ? queueCaseIds[currentIdx - 1] : null;
  const nextId = currentIdx >= 0 && currentIdx < queueCaseIds.length - 1 ? queueCaseIds[currentIdx + 1] : null;

  function navigateTo(id: string) {
    navigate(`/main/callbacks/${encodeURIComponent(id)}/detail`, {
      state: { queueCaseIds, returnTo },
    });
  }

  async function loadDetail() {
    if (!caseId) return;
    setDetail(null);
    setVerificationQuestions([]);
    setVerificationAnswers({});
    setProceeded(false);
    setQuestionNotice(null);
    setLoadError("");
    try {
      const data = await apiFetch<CallbackDetail>(
        `/api/main-survey/callbacks/${encodeURIComponent(caseId)}/detail`,
        {},
        token,
        45000,
      );
      setDetail(data);
      setVerificationQuestions(data.verification_questions ?? []);
      setProceeded((data.verification_questions ?? []).every((item) => item.is_correct !== null));
      const initialVerification = Object.fromEntries(
        (data.verification_questions ?? [])
          .filter((item) => item.callback_answer || item.is_correct !== null)
          .map((item) => [
            item.position,
            { callbackAnswer: item.callback_answer ?? "", isCorrect: item.is_correct },
          ]),
      ) as Record<number, { callbackAnswer: string; isCorrect: boolean | null }>;
      setVerificationAnswers(initialVerification);
      setOutcomeCode("completed");
      setQuestionMode("qc");
      setQuestionNotice(null);
      setOutcomeNote("");
      setSaveError("");
      setStatusResult(null);
      setSelectedRole("");
      setSelectedUserId("");
      setAssignmentResult(null);
      setAccStatus(data.accompaniment?.verification_status ?? "needs_review");
      setAccNote(data.accompaniment?.verification_note ?? "");
      setAccResult(null);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Failed to load case detail.");
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
    if (caseId) setFallbackQueueCaseIds(buildSyntheticCallbackQueue(caseId));
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

  async function handleUnassignCallback() {
    if (!detail) return;
    setAssignmentSaving(true);
    setAssignmentResult(null);
    try {
      setDetail({
        ...detail,
        callback_history: detail.callback_history.map((attempt, index) =>
          index === detail.callback_history.length - 1
            ? { ...attempt, assigned_to_user_id: null, assigned_to_username: null }
            : attempt,
        ),
      });
      setAssignmentResult({ ok: true, msg: "Callback assignment removed." });
    } catch (err) {
      setAssignmentResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to unassign callback." });
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function handleReassignCallback() {
    if (!detail) return;
    setAssignmentSaving(true);
    setAssignmentResult(null);
    try {
      const selectedUser = roleUsers.find((entry) => entry.user_id === selectedUserId);
      setDetail({
        ...detail,
        callback_history: detail.callback_history.map((attempt, index) =>
          index === detail.callback_history.length - 1
            ? {
                ...attempt,
                assigned_to_user_id: selectedUserId || null,
                assigned_to_username: selectedUser?.username ?? (selectedRole ? `${selectedRole}_101` : null),
              }
            : attempt,
        ),
      });
      setAssignmentResult({ ok: true, msg: "Callback assignment updated." });
    } catch (err) {
      setAssignmentResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to reassign callback." });
    } finally {
      setAssignmentSaving(false);
    }
  }

  useEffect(() => {
    if (!caseId || !detail) return;
    const decodedCaseId = decodeURIComponent(caseId);
    let active = true;
    async function ensureVerificationQuestions() {
      setVerificationLoading(true);
      setQuestionNotice(null);
      try {
        const payload = await apiFetch<VerificationQuestionsResponse>(
          `/api/main-survey/callbacks/${encodeURIComponent(decodedCaseId)}/verification-questions?mode=${encodeURIComponent(questionMode)}`,
          {},
          token,
          45000,
        );
        if (!active) return;
        setVerificationQuestions(payload.questions ?? []);
        if (payload.fallback && payload.mode === "random") {
          setQuestionMode("random");
          setQuestionNotice("No QC issue questions were available for this case, so random questions were loaded instead.");
        }
        const initial = Object.fromEntries(
          (payload.questions ?? [])
            .filter((item) => item.callback_answer || item.is_correct !== null)
            .map((item) => [
              item.position,
              { callbackAnswer: item.callback_answer ?? "", isCorrect: item.is_correct },
            ]),
        ) as Record<number, { callbackAnswer: string; isCorrect: boolean | null }>;
        setVerificationAnswers(initial);
        setProceeded((payload.questions ?? []).every((item) => item.is_correct !== null));
      } catch (err) {
        if (active) {
          setQuestionNotice(err instanceof Error ? err.message : "Unable to load verification questions.");
          setVerificationQuestions([]);
        }
      } finally {
        if (active) setVerificationLoading(false);
      }
    }
    void ensureVerificationQuestions();
    return () => {
      active = false;
    };
  }, [caseId, detail, questionMode]);

  const latestAttempt = detail?.callback_history.at(-1) ?? null;
  const latestPending = latestAttempt?.outcome_code === "pending" ? latestAttempt : null;
  const callbackAssignee = useMemo(() => {
    const assigned = [...(detail?.callback_history ?? [])].reverse().find((attempt) => attempt.assigned_to_username || attempt.assigned_to_user_id);
    return assigned?.assigned_to_username || assigned?.assigned_to_user_id || "Unassigned";
  }, [detail?.callback_history]);

  const lockedByOther = false;
  const canRecordOutcome = Boolean(
    latestPending &&
      user &&
      (user.role !== "PDM-QC" || latestPending.assigned_to_user_id === user.id),
  );

  // Derive pipeline progress
  const callMade = !!latestAttempt && latestAttempt.outcome_code !== "pending";
  const caseDecided =
    detail?.approval_stage === "approved" || detail?.approval_stage === "rejected";

  function openNotConductedOutcomeModal() {
    setOutcomeCode("unreachable");
    setOutcomeNote("Respondent verification was not conducted.");
    setSaveError("");
    setOutcomeModalOpen(true);
  }

  async function handleSubmitOutcome(): Promise<boolean> {
    if (!latestPending) return false;
    setSaving(true);
    setSaveError("");
    try {
      const updated = await apiFetch<{
        callback_id: string;
        case_id: string;
        outcome_code: string;
        outcome_note: string | null;
        completed_at: string | null;
        updated_at: string | null;
      }>(
        `/api/main-survey/callbacks/${encodeURIComponent(latestPending.callback_id)}/outcome`,
        {
          method: "POST",
          body: JSON.stringify({
            outcome_code: outcomeCode,
            outcome_note: outcomeNote || null,
          }),
        },
        token,
        45000,
      );
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              callback_history: prev.callback_history.map((attempt) =>
                attempt.callback_id === latestPending.callback_id
                  ? {
                      ...attempt,
                      outcome_code: updated.outcome_code,
                      outcome_note: updated.outcome_note,
                      completed_at: updated.completed_at ?? attempt.completed_at,
                    }
                  : attempt,
              ),
            }
          : prev,
      );
      return true;
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Failed to save outcome.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleOutcomeModalSave() {
    const ok = await handleSubmitOutcome();
    if (ok) {
      setOutcomeModalOpen(false);
    }
  }

  async function handleStatusUpdate(status: string) {
    if (!detail) return;
    setStatusSaving(true);
    setStatusResult(null);
    try {
      await apiFetch(
        "/api/main-survey/cases/bulk-status",
        {
          method: "POST",
          body: JSON.stringify({
            submission_keys: [detail.submission_key],
            status,
            note: statusNote || null,
          }),
        },
        token,
        45000,
      );
      if (status === "approved" || status === "rejected") {
        setDetail({ ...detail, approval_stage: status, is_callback_required: false });
        navigate(returnTo);
      } else {
        setDetail({ ...detail, approval_stage: status });
        setStatusResult({ ok: true, msg: `Status updated to "${formatToken(status)}".` });
        setStatusNote("");
      }
    } catch (e: unknown) {
      setStatusResult({ ok: false, msg: e instanceof Error ? e.message : "Failed to update status." });
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleSaveVerification(position: number, callbackAnswer: string, isCorrect: boolean) {
    if (!caseId) return;
    const decodedCaseId = decodeURIComponent(caseId);
    setSavingVerification(position);
    try {
      const updated = await apiFetch<VerificationQuestion>(
        `/api/main-survey/callbacks/${encodeURIComponent(decodedCaseId)}/verification-questions/${position}`,
        {
          method: "PATCH",
          body: JSON.stringify({ callback_answer: callbackAnswer, is_correct: isCorrect }),
        },
        token,
        45000,
      );

      setVerificationAnswers((prev) => ({
        ...prev,
        [position]: { callbackAnswer: updated.callback_answer ?? "", isCorrect: updated.is_correct },
      }));
      setVerificationQuestions((prev) =>
        prev.map((item) => (item.position === position ? { ...item, ...updated } : item)),
      );
    } finally {
      setSavingVerification(null);
    }
  }

  async function saveAccompanimentVerification() {
    if (!detail) return;
    setAccSaving(true);
    setAccResult(null);
    try {
      const saved = { verification_status: accStatus, verification_note: accNote || null, verified_at: new Date().toISOString() };
      setDetail((prev) => (prev ? { ...prev, accompaniment: { ...(prev.accompaniment ?? {}), ...(saved ?? {}) } } : prev));
      setAccResult({ ok: true, msg: "Accompaniment verification saved." });
    } catch (err) {
      setAccResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to save accompaniment verification." });
    } finally {
      setAccSaving(false);
    }
  }

  const accompanimentValue = (detail?.accompaniment?.accompanied_value ?? detail?.supacc_confirm ?? "").toString();
  const accompanimentYes = ["yes", "1", "true"].includes(accompanimentValue.trim().toLowerCase());
  const accompanimentImageUrl = getMainMediaUrl(detail?.accompaniment?.picture_url ?? detail?.sup_photo);

  const audioEntries = detail ? getAudioItems(detail) : [];
  const hasAudio = audioEntries.length > 0;
  const canDecide = Boolean(user);
  const verificationStats = useMemo(() => {
    const answered = verificationQuestions.filter((question) => question.is_correct !== null);
    const accurate = answered.filter((question) => question.is_correct === true).length;
    const mismatch = answered.filter((question) => question.is_correct === false).length;
    const total = answered.length;
    return {
      total,
      accurate,
      mismatch,
      accuratePct: total ? Math.round((accurate / total) * 100) : 0,
      mismatchPct: total ? Math.round((mismatch / total) * 100) : 0,
    };
  }, [verificationQuestions]);

  if (!loadError && detail) {
    const completedAttempts = detail.callback_history.filter((attempt) => attempt.outcome_code !== "pending").length;
    const displayCaseLabel = detail.case_label || "Selected case";
    return (
      <PlatformPage
        title="Respondent Recontact Individual Case"
        subtitle={`Recontact workspace for ${displayCaseLabel}`}
        syncLabel=""
        module="main"
        plainTopBar
        topBarActions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(returnTo)} className="flex items-center gap-1.5 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50">
              <ChevronLeft className="h-3.5 w-3.5" /> Recontact Section
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
              Back to Respondent Recontact Section
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

          <section className="space-y-5">
            <div className="overflow-hidden rounded-[2rem] border border-white/60 bg-white/48 shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
              <div className="bg-gradient-to-br from-indigo-900 via-sky-800 to-teal-600 p-7 text-white">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-100/80">Respondent recontact file</p>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight">{displayCaseLabel}</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/90">Confirm interview authenticity, respondent recall, and international remittance answers before final QC action.</p>
                  </div>
                  <Badge variant="outline" className={cn("rounded-full border-white/30 bg-white/15 px-3 py-1.5 text-xs text-white", statusBadgeClass(detail.approval_stage))}>{formatToken(detail.approval_stage)}</Badge>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[["Attempts", String(detail.callback_history.length)], ["Completed", String(completedAttempts)], ["Phone", detail.phone_no ?? "--"], ["Assignee", callbackAssignee]].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/20 bg-white/12 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-100/70">{label}</p>
                      <p className="mt-2 text-sm font-black text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
                <MetaField label="Case key" value={detail.submission_key} />
                <MetaField label="Respondent name" value={detail.respondent_name} />
                <MetaField label="Respondent address" value={detail.respondent_address} />
                <MetaField label="Region" value={detail.region_label ?? detail.state_name ?? detail.lga_name} />
                <MetaField label="Selected panels" value={detail.selected_panel_labels ?? "Omnibus"} />
                <MetaField label="Submitted" value={detail.submitted_at ? formatDate(detail.submitted_at) : null} />
                <MetaField label="Interviewer" value={detail.interviewer_id} />
                <MetaField label="Respondent Phone Number" value={detail.phone_no} />
                <MetaField label="Region" value={detail.region_label ?? detail.state_name} />
                <MetaField label="Sector" value={detail.lga_name} />
              </div>
            </div>

            {lockedByOther ? (
              <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>In review by {latestPending?.assigned_to_username ?? "another reviewer"}.</span>
              </div>
            ) : null}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
            <Card className="rounded-[1.7rem] border-white/70 bg-white/48">
              <CardContent className="p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">Verification questions</p>
                    <h3 className="mt-1 text-xl font-black text-slate-950">Respondent recall check</h3>
                  </div>
                  <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
                    <button type="button" onClick={() => setQuestionMode("qc")} className={cn("rounded-xl px-3 py-1.5 text-xs font-black", questionMode === "qc" ? "bg-sky-600 text-white" : "text-slate-500")}>QC issues</button>
                    <button type="button" onClick={() => setQuestionMode("random")} className={cn("rounded-xl px-3 py-1.5 text-xs font-black", questionMode === "random" ? "bg-sky-600 text-white" : "text-slate-500")}>Random</button>
                  </div>
                </div>
                {!proceeded ? (
                  <div className="mb-5 space-y-4">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-sm leading-6 text-slate-700">
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">Call script</p>
                      Hello, good {getGreeting()}. My name is [Agent Name], and I am calling from Inicio Insights about the 3 Categories interview you recently completed. One of our interviewers spoke with you about spread, edible oil, or breakfast cereal. I am calling to confirm that the interview took place and to verify a few responses for quality control. This will only take a few minutes, and your responses remain confidential.
                    </div>
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                      <p className="text-sm font-bold text-slate-700">Proceed with respondent verification?</p>
                      <button type="button" onClick={() => setProceeded(true)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white">Yes, proceed</button>
                      <button type="button" onClick={openNotConductedOutcomeModal} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white">No, not conducted</button>
                    </div>
                  </div>
                ) : null}
                {verificationLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading questions...</div>
                ) : (
                  <div className="space-y-4">
                    {verificationQuestions.map((q) => {
                      const local = verificationAnswers[q.position] ?? { callbackAnswer: q.callback_answer ?? "", isCorrect: q.is_correct };
                      const locked = q.is_correct !== null;
                      return (
                        <div key={q.position} className="rounded-2xl border border-slate-200/70 bg-white/72 p-4">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-sky-600 px-2.5 py-1 text-xs font-black text-white">Q{q.position}</span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{q.section_name}</span>
                          </div>
                          <p className="text-sm font-black text-slate-900">{q.question_label}</p>
                          <p className="mt-2 text-sm text-slate-600">Recorded answer: <strong className="text-emerald-700">{q.respondent_answer_label}</strong></p>
                          <textarea disabled={locked || !proceeded} value={local.callbackAnswer} onChange={(e) => setVerificationAnswers((prev) => ({ ...prev, [q.position]: { callbackAnswer: e.target.value, isCorrect: prev[q.position]?.isCorrect ?? q.is_correct } }))} rows={2} placeholder="Type respondent's recontact answer" className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100" />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={locked || !proceeded || savingVerification === q.position || !local.callbackAnswer.trim()} onClick={() => void handleSaveVerification(q.position, local.callbackAnswer, true)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Accurate</button>
                            <button type="button" disabled={locked || !proceeded || savingVerification === q.position || !local.callbackAnswer.trim()} onClick={() => void handleSaveVerification(q.position, local.callbackAnswer, false)} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Mismatch</button>
                            {locked ? <span className="self-center text-xs font-bold text-slate-500">Saved {q.verified_at ? formatDate(q.verified_at) : ""}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                    {!verificationQuestions.length ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">
                        No respondent recall questions were available for this case. Confirm the latest XLSForm dictionary has select-one questions with recorded answers for this submission.
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card className="rounded-[1.7rem] border-white/70 bg-white/48">
                <CardContent className="p-5">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">Recall accuracy summary</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Accurate</p>
                      <p className="mt-2 text-2xl font-black text-emerald-800">{verificationStats.accurate}</p>
                      <p className="text-xs font-bold text-emerald-700">{verificationStats.accuratePct}% of verified</p>
                    </div>
                    <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-700">Mismatch</p>
                      <p className="mt-2 text-2xl font-black text-rose-800">{verificationStats.mismatch}</p>
                      <p className="text-xs font-bold text-rose-700">{verificationStats.mismatchPct}% of verified</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">{verificationStats.total} verified response{verificationStats.total === 1 ? "" : "s"} counted.</p>
                </CardContent>
              </Card>

              <Card className="rounded-[1.7rem] border-white/70 bg-white/48">
                <CardContent className="p-5">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">Recontact outcome</p>
                  <div className="mt-4 space-y-3">
                    {detail.callback_history.length === 0 ? (
                      <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-3 text-sm text-amber-800">
                        No callback attempt is currently linked to this case. Push or assign the case from the Respondent Recontact Section first.
                      </div>
                    ) : null}
                    {detail.callback_history.map((attempt) => (
                      <div key={attempt.callback_id} className="rounded-2xl border border-slate-200/70 bg-white/72 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-black text-slate-900">Attempt #{attempt.attempt_no}</span>
                          <Badge variant="outline" className={cn("rounded-full text-xs", OUTCOME_BADGE[attempt.outcome_code] ?? "border-slate-300 bg-white text-slate-700")}>{formatToken(attempt.outcome_code)}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{attempt.completed_at ? formatDate(attempt.completed_at) : attempt.created_at ? `Created ${formatDate(attempt.created_at)}` : "Synthetic attempt"}</p>
                      </div>
                    ))}
                  </div>
                  {canRecordOutcome ? (
                    <div className="mt-4 space-y-3 rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
                      <select value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900">
                        {CALLBACK_OUTCOME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      <textarea value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} rows={3} placeholder="Outcome note" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
                      {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : null}
                      <Button type="button" onClick={() => void handleSubmitOutcome()} disabled={saving} className="w-full rounded-2xl bg-sky-600 hover:bg-sky-700">{saving ? "Saving..." : "Save recontact outcome"}</Button>
                    </div>
                  ) : latestPending ? (
                    <p className="mt-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm text-slate-600">
                      This pending callback is assigned to {latestPending.assigned_to_username ?? "another reviewer"}.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              {audioEntries.length ? (
                <Card className="rounded-[1.7rem] border-white/70 bg-white/48">
                  <CardContent className="p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">Reference audio</p>
                    <div className="mt-4 space-y-3">
                      {audioEntries.map((entry) => (
                        <div key={entry.variable_name} className="rounded-2xl border border-slate-200/70 bg-white/72 p-3">
                          <p className="mb-2 text-xs font-black text-slate-700">{entry.label}</p>
                          <audio controls src={getMainMediaUrl(entry.media_url || entry.file_name) ?? undefined} className="h-8 w-full" preload="none" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

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
            </div>
          </section>
          {outcomeModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-600">
                  <PhoneCall className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-xl font-black text-slate-950">Record recontact outcome</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Select why the respondent verification was not conducted. This records the callback outcome for the current pending attempt.
                </p>
                <div className="mt-5 space-y-3">
                  <select value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900">
                    {CALLBACK_OUTCOME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                  <textarea value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} rows={3} placeholder="Outcome note" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
                  {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : null}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setOutcomeModalOpen(false)} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
                  <button type="button" onClick={() => void handleOutcomeModalSave()} disabled={saving || !canRecordOutcome} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {saving ? "Saving..." : "Save outcome"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </PlatformPage>
    );
  }

}
