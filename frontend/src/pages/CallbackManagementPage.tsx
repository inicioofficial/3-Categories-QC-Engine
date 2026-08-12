import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Eye, EyeOff, Lock, PhoneCall, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Square, CheckSquare, UserCheck, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { PlatformPage, SELECT_CLASS, formatDate, formatToken, statusBadgeClass, truncateValue } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { createSurveyCtoSession, hasValidSurveyCtoSession } from "@/lib/surveyctoSession";
import { cn } from "@/lib/utils";
import { matchesSearchTerm } from "@/lib/search";
import { getSurveyWorkspace } from "@/data/workspaces";

const OUTCOME_OPTIONS = [
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
  temporary_network_failure: "border-amber-500/30 bg-amber-500/12 text-amber-700",
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

interface CallbackCase {
  submission_key: string;
  case_id: string;
  ea_id: string | null;
  interviewer_id: string | null;
  supervisor_id: string | null;
  approval_stage: string;
  ea_name: string | null;
  lga_name: string | null;
  state_name: string | null;
  region_label?: string | null;
  region_respondent_ordinal?: number | null;
  start_time?: string | null;
  submitted_at?: string | null;
  selected_panel_labels: string | null;
  open_issue_count?: number;
  qc_flag_count?: number;
  callback_history: CallbackAttempt[] | null;
}

type ModalState =
  | { mode: "outcome"; callbackId?: string }
  | { mode: "assign"; caseId: string; submissionKey: string; assignedRole: string; assignedUserId: string }
  | null;

const QC_ROLES = [
  { value: "PDM-QC", label: "PDM-QC" },
] as const;
const ACTIVE_REVIEW_STAGES = new Set(["pending_review", "in_review"]);
const CALLBACK_STATUS_OPTIONS = [
  { value: "pending_review", label: "Pending Review" },
  { value: "in_review", label: "In Review" },
  { value: "corrected", label: "Corrected" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "submitted", label: "Submitted" },
];

function callbackRegionLabel(item: CallbackCase) {
  const raw = item.region_label?.trim() || item.state_name?.trim() || item.lga_name?.trim() || "Region";
  return raw.toLowerCase() === "unknown" ? "Region" : raw.replace(/\s+/g, "_");
}

function callbackCaseTitle(item: CallbackCase) {
  return `${callbackRegionLabel(item)}_Resp._${item.region_respondent_ordinal ?? 1}`;
}

function callbackStatusLabel(item: CallbackCase) {
  return item.approval_stage === "reviewed_approved" ? "Reviewed and Approved" : item.approval_stage === "reviewed_rejected" ? "Reviewed and Reject" : formatToken(item.approval_stage);
}

export function CallbackManagementPage() {
  const { token, user, selectedWorkspace } = useAuth();
  const workspace = getSurveyWorkspace(selectedWorkspace);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<CallbackCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [outcomeCode, setOutcomeCode] = useState("completed");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [roleUsers, setRoleUsers] = useState<{ user_id: string; username: string; full_name: string }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>(() => (searchParams.get("status") ?? "").split(",").filter(Boolean));
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("date_to") ?? "");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [surveyLoggingIn, setSurveyLoggingIn] = useState(false);
  const [surveyUsername, setSurveyUsername] = useState("");
  const [surveyPassword, setSurveyPassword] = useState("");
  const [showSurveyPassword, setShowSurveyPassword] = useState(false);
  const [surveyLoginError, setSurveyLoginError] = useState<string | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);

  const canManageAssignments = Boolean(user);
  const canUnassignCases = canManageAssignments && user?.role !== "PDM-QC";

  async function loadCallbacks() {
    setLoading(true);
    try {
      const payload = await apiFetch<{ items: CallbackCase[] }>("/api/main-survey/callbacks", {}, token, 45000);
      setItems(payload.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCallbacks();
  }, [token]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (statusFilter.length) next.set("status", statusFilter.join(","));
    if (search.trim()) next.set("search", search.trim());
    if (dateFrom) next.set("date_from", dateFrom);
    if (dateTo) next.set("date_to", dateTo);
    const current = searchParams.toString();
    const upcoming = next.toString();
    if (current !== upcoming) setSearchParams(next, { replace: true });
  }, [statusFilter, search, dateFrom, dateTo, searchParams, setSearchParams]);

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
    if (modal?.mode === "assign" && selectedRole) {
      void loadUsersByRole(selectedRole);
    } else {
      setRoleUsers([]);
    }
  }, [modal, selectedRole, token]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const latest = (item.callback_history ?? []).at(-1);
      const statusValue = item.approval_stage ?? "";
      if (statusFilter.length && !statusFilter.includes(statusValue)) return false;
      if (dateFrom || dateTo) {
        const sourceDate = latest?.created_at ?? latest?.completed_at ?? null;
        const shortDate = sourceDate ? String(sourceDate).slice(0, 10) : "";
        if (dateFrom && (!shortDate || shortDate < dateFrom)) return false;
        if (dateTo && (!shortDate || shortDate > dateTo)) return false;
      }
      return matchesSearchTerm(item, term, [
        callbackCaseTitle(item),
        callbackStatusLabel(item),
        latest?.assigned_to_username ? null : "Unassigned",
        formatDate(item.start_time ?? item.submitted_at ?? latest?.created_at),
      ]);
    });
  }, [items, statusFilter, search, dateFrom, dateTo]);

  const eligibleVisibleKeys = useMemo(() => filteredItems.filter((item) => ACTIVE_REVIEW_STAGES.has((item.approval_stage || "").toLowerCase())).map((item) => item.submission_key), [filteredItems]);
  const allVisibleSelected = eligibleVisibleKeys.length > 0 && eligibleVisibleKeys.every((key) => selectedKeys.includes(key));

  useEffect(() => {
    setSelectedKeys((prev) => prev.filter((key) => items.some((item) => item.submission_key === key)));
  }, [items]);

  function toggleSelected(key: string) {
    setSelectedKeys((prev) => prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]);
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedKeys((prev) => prev.filter((key) => !eligibleVisibleKeys.includes(key)));
      return;
    }
    setSelectedKeys((prev) => Array.from(new Set([...prev, ...eligibleVisibleKeys])));
  }

  async function handleBulkUnassign() {
    if (!selectedKeys.length) return;
    setBulkSaving(true);
    setBulkMessage(null);
    try {
      const removed = selectedKeys.length;
      await apiFetch(
        "/api/main-survey/callbacks/bulk-unassign",
        { method: "POST", body: JSON.stringify({ submission_keys: selectedKeys }) },
        token,
        45000,
      );
      setSelectedKeys([]);
      await loadCallbacks();
      setBulkMessage(`${removed} recontact case(s) retrieved.`);
    } catch (err) {
      setBulkMessage(err instanceof Error ? err.message : "Failed to retrieve recontact cases.");
    } finally {
      setBulkSaving(false);
    }
  }

  function openOutcome(callbackId: string) {
    setModal({ mode: "outcome", callbackId });
    setOutcomeCode("completed");
    setOutcomeNote("");
    setError("");
  }

  function openAssign(item: CallbackCase) {
    const latest = (item.callback_history ?? []).at(-1);
    setModal({ mode: "assign", caseId: item.case_id, submissionKey: item.submission_key, assignedRole: "PDM-QC", assignedUserId: latest?.assigned_to_user_id ?? "" });
    setSelectedRole("PDM-QC");
    setSelectedUserId(latest?.assigned_to_user_id ?? "");
    setError("");
  }

  function closeModal() {
    setModal(null);
    setError("");
    setSelectedRole("");
    setSelectedUserId("");
    setRoleUsers([]);
  }

  async function handleRecordOutcome() {
    if (modal?.mode !== "outcome" || !modal.callbackId) return;
    setSaving(true);
    setError("");
    try {
      const updated = await apiFetch<{
        callback_id: string;
        case_id: string;
        outcome_code: string;
        outcome_note: string | null;
        completed_at: string | null;
        updated_at: string | null;
      }>(
        `/api/main-survey/callbacks/${encodeURIComponent(modal.callbackId)}/outcome`,
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
      setItems((current) => current.map((item) => ({
        ...item,
        callback_history: (item.callback_history ?? []).map((attempt) =>
          attempt.callback_id === modal.callbackId
            ? {
                ...attempt,
                outcome_code: updated.outcome_code,
                outcome_note: updated.outcome_note,
                completed_at: updated.completed_at ?? attempt.completed_at,
              }
            : attempt,
        ),
      })));
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record outcome.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignmentSave() {
    if (modal?.mode !== "assign") return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(
        "/api/main-survey/callbacks/bulk",
        {
          method: "POST",
          body: JSON.stringify({
            submission_keys: [modal.submissionKey],
            assigned_to_role: selectedRole || null,
            assigned_to_user_id: selectedUserId || null,
          }),
        },
        token,
        45000,
      );
      await loadCallbacks();
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update assignment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignmentRemove() {
    if (modal?.mode !== "assign") return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/main-survey/callbacks/${encodeURIComponent(modal.caseId)}/unassign`, { method: "POST" }, token, 45000);
      await loadCallbacks();
      closeModal();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to retrieve recontact case.");
    } finally {
      setSaving(false);
    }
  }

  const approvedCount = items.filter((c) => c.approval_stage === "approved").length;
  const pendingCount = Math.max(items.length - approvedCount, 0);
  const stats = { total: items.length, approved: approvedCount, pending: pendingCount };
  const activeQcUsers = new Set(
    items
      .flatMap((item) => item.callback_history ?? [])
      .map((attempt) => attempt.assigned_to_user_id || attempt.assigned_to_username)
      .filter(Boolean),
  ).size;
  const queueCaseIds = filteredItems.map((c) => c.case_id);
  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (statusFilter.length) chips.push(`Status: ${statusFilter.map(formatToken).join(", ")}`);
    if (search.trim()) chips.push(`Search: ${search.trim()}`);
    if (dateFrom || dateTo) chips.push(`Date: ${dateFrom || "..."} to ${dateTo || "..."}`);
    return chips;
  }, [dateFrom, dateTo, search, statusFilter]);

  function openDetail(caseId: string) {
    if (hasValidSurveyCtoSession()) {
      navigateToDetail(caseId);
      return;
    }
    setPendingCaseId(caseId);
    setSurveyModalOpen(true);
    setSurveyLoggingIn(false);
  }

  function navigateToDetail(caseId: string) {
    const returnTo = `/main/callbacks${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    navigate(`/main/callbacks/${encodeURIComponent(caseId)}/detail`, {
      state: { queueCaseIds, returnTo },
    });
  }

  async function submitSurveyLogin() {
    if (!pendingCaseId) return;
    setSurveyLoggingIn(true);
    setSurveyLoginError(null);
    try {
      if (!workspace) throw new Error("Select a category workspace before signing in to SurveyCTO.");
      await createSurveyCtoSession(token, surveyUsername, surveyPassword, workspace.formId);
      const nextCaseId = pendingCaseId;
      setSurveyLoggingIn(false);
      setSurveyModalOpen(false);
      setSurveyUsername("");
      setSurveyPassword("");
      setPendingCaseId(null);
      navigateToDetail(nextCaseId);
    } catch (error) {
      setSurveyLoggingIn(false);
      setSurveyLoginError(error instanceof Error ? error.message : "SurveyCTO login failed.");
    }
  }

  function getAssignState(item: CallbackCase): "unassigned_pending" | "mine" | "others" | "no_attempt" | "closed" {
    const latest = (item.callback_history ?? []).at(-1);
    if (!latest) return "no_attempt";
    if (latest.outcome_code !== "pending") return "closed";
    if (!latest.assigned_to_user_id) return "unassigned_pending";
    if (user?.role === "SUPERADMIN" || user?.role === "PDM-ADMIN") return "mine";
    if (latest.assigned_to_user_id === user?.id) return "mine";
    return "others";
  }

  return (
    <PlatformPage
      title="Respondent Recontact Section"
      subtitle="Cases routed for respondent recontact follow-up"
      syncLabel=""
      module="main"
      hideTopBar={false}
      plainTopBar
      topBarActions={
        <div className="flex items-center gap-2">
          {pendingCount > 0 && <span className="rounded-full border border-amber-400/40 bg-amber-50/60 px-3 py-1 text-xs font-semibold text-amber-700">{pendingCount} pending</span>}
          <button type="button" onClick={() => void loadCallbacks()} className="flex items-center gap-1.5 rounded-[1rem] border border-white/50 bg-white/30 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/50"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
        </div>
      }
    >
      <div className="space-y-4">
        <KpiStrip items={[
          { label: "Active QC users", value: activeQcUsers.toLocaleString("en-US"), tone: "blue" },
          { label: "Total tasks pushed", value: stats.total.toLocaleString("en-US"), tone: "blue" },
          { label: "Completed", value: stats.approved.toLocaleString("en-US"), tone: "emerald" },
          { label: "Pending", value: stats.pending.toLocaleString("en-US"), tone: stats.pending > 0 ? "amber" : "slate" },
        ]} />

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setFilterModalOpen(true)} className="inline-flex w-fit items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.25)] hover:bg-sky-700">
            <SlidersHorizontal className="h-4 w-4" />
            Control filters
          </button>
          {activeFilterChips.map((chip) => (
            <span key={chip} className="rounded-full border border-sky-100 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">{chip}</span>
          ))}
        </div>
        <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
          <DialogContent className="max-w-5xl rounded-3xl border-white/70 bg-white/95 p-0">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Respondent Recontact filters</DialogTitle>
            </DialogHeader>
        <Card className="glass-panel overflow-visible rounded-[1.8rem] border-white/70">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3"><SlidersHorizontal className="h-5 w-5 text-emerald-600" /><div><p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Control filters</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Narrow the recontact queue by status, search, or date</h3></div></div>
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
              <div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Status</label><MultiSelectDropdown label="statuses" options={CALLBACK_STATUS_OPTIONS} selected={statusFilter} onChange={setStatusFilter} /></div>
              <div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Search</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input placeholder="Case ID, Ward ID, Ward, LGA, State, interviewer or assignee" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" /></div></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:w-[320px]"><div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Date from</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div><div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Date to</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div></div>
            </div>
            {(statusFilter.length || search || dateFrom || dateTo) ? <div className="flex justify-end"><button type="button" onClick={() => { setStatusFilter([]); setSearch(""); setDateFrom(""); setDateTo(""); }} className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/50 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/80"><X className="h-3.5 w-3.5" />Reset</button></div> : null}
            <div className="flex justify-end"><button type="button" onClick={() => setFilterModalOpen(false)} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700">Apply</button></div>
          </CardContent>
        </Card>
          </DialogContent>
        </Dialog>

        <Card className="glass-card overflow-hidden rounded-2xl border-0 shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/20 px-6 py-4">
              <div><p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Submission queue</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Respondent recontact cases</h3></div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-white/70 bg-white/50 px-3 py-1 text-xs text-slate-600">{filteredItems.length} cases loaded</span>
                <button type="button" onClick={() => void loadCallbacks()} className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/60"><RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />Refresh</button>
              </div>
            </div>
            {canManageAssignments ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-white/20 px-6 py-3">
                <button type="button" onClick={toggleSelectAllVisible} className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/55 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white/80">{allVisibleSelected ? <CheckSquare className="h-3.5 w-3.5 text-sky-600" /> : <Square className="h-3.5 w-3.5" />}{allVisibleSelected ? "Clear visible" : "Select visible"}</button>
                {selectedKeys.length ? <span className="text-sm font-medium text-sky-700">{selectedKeys.length} selected</span> : null}
                {canUnassignCases ? <button type="button" onClick={() => void handleBulkUnassign()} disabled={!selectedKeys.length || bulkSaving} className="rounded-full border border-amber-300/40 bg-amber-50/60 px-4 py-2 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50">{bulkSaving ? "Unassigning…" : "Unassign selected"}</button> : null}
                {bulkMessage ? <span className="rounded-full border border-rose-200/50 bg-rose-50/50 px-3 py-1 text-xs text-rose-700">{bulkMessage}</span> : null}
              </div>
            ) : null}
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredItems.map((item) => {
                const latestAttempt = (item.callback_history ?? []).at(-1);
                const assignState = getAssignState(item);
                const isEligible = ACTIVE_REVIEW_STAGES.has((item.approval_stage || "").toLowerCase());
                const issueCount = Math.max(Number(item.open_issue_count ?? 0), Number(item.qc_flag_count ?? 0));
                const loadTone = issueCount >= 5 ? "text-rose-700" : issueCount >= 2 ? "text-amber-700" : "text-emerald-700";
                return (
                  <article key={item.submission_key} className={cn("rounded-2xl border border-white/70 bg-white/62 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]", selectedKeys.includes(item.submission_key) && "border-sky-300 bg-sky-50/70")}>
                    <div className="flex items-start gap-3">
                      {canManageAssignments ? <button type="button" disabled={!isEligible} onClick={() => toggleSelected(item.submission_key)} className="mt-1 text-slate-400 hover:text-slate-700 disabled:opacity-40">{selectedKeys.includes(item.submission_key) ? <CheckSquare className="h-4 w-4 text-sky-600" /> : <Square className="h-4 w-4" />}</button> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">{truncateValue(item.case_id ?? item.submission_key, 22)}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-semibold text-slate-950">{callbackCaseTitle(item)}</h4>
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700" title="Pushed to Respondent Recontact Section">
                                <PhoneCall className="h-3 w-3" />
                                Recontact
                              </span>
                            </div>
                            {item.ea_name || item.ea_id ? <p className="mt-0.5 text-xs text-slate-500">{item.ea_name ?? item.ea_id}</p> : null}
                            <p className="mt-1 text-xs font-medium text-slate-600"><span className="font-bold text-slate-700">Selected Panels:</span> {item.selected_panel_labels ?? "Omnibus"}</p>
                            <p className={`mt-1 text-xs font-bold ${loadTone}`}>Auto-flagged QC Issues: {issueCount}</p>
                          </div>
                          <Badge variant="outline" className={cn("border text-[11px] font-semibold", statusBadgeClass(item.approval_stage))}>{callbackStatusLabel(item)}</Badge>
                        </div>
                        <div className="hidden">
                          <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Attempts</p><p className="mt-1 text-lg font-bold text-slate-950">{(item.callback_history ?? []).length}</p></div>
                          <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Outcome</p><p className="mt-1 text-sm font-bold text-emerald-700">{latestAttempt ? formatToken(latestAttempt.outcome_code) : "-"}</p></div>
                          <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Assignee</p><p className="mt-1 text-sm font-bold text-slate-700">{latestAttempt?.assigned_to_username ?? "Unassigned"}</p></div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-slate-200/70 pt-2.5">
                          <div className="space-y-1 text-xs text-slate-500">
                            <div><span className="font-semibold uppercase tracking-[0.08em] text-slate-700">Start Date/Time:</span> {formatDate(item.start_time ?? item.submitted_at ?? latestAttempt?.created_at)}</div>
                            <div><span className="font-semibold text-slate-700">Assigned to:</span> {latestAttempt?.assigned_to_username ?? "Unassigned"}</div>
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            {assignState === "others" && latestAttempt ? (
                              <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
                                <Lock className="h-3.5 w-3.5" />
                                {latestAttempt.assigned_to_username ? `In review by ${latestAttempt.assigned_to_username}` : "In review"}
                              </span>
                            ) : null}
                            <button type="button" onClick={() => openDetail(item.case_id)} className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">Open case</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {filteredItems.length === 0 ? <div className="col-span-full py-12 text-center text-sm text-slate-500">No cases require recontact.</div> : null}
            </div>

            <div className="hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/20">
                  {canManageAssignments ? <TableHead className="w-10 pl-6 text-slate-600"></TableHead> : null}
                  <TableHead className="pl-6 text-slate-600">Case ID</TableHead>
                  <TableHead className="text-slate-600">Ward / Location</TableHead>
                  <TableHead className="text-slate-600">Interviewer</TableHead>
                  <TableHead className="text-slate-600">Stage</TableHead>
                  <TableHead className="text-slate-600">Recontact History</TableHead>
                  <TableHead className="pr-6 text-right text-slate-600">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={canManageAssignments ? 7 : 6} className="py-8 text-center text-slate-400">Loading...</TableCell></TableRow> : filteredItems.length === 0 ? <TableRow><TableCell colSpan={canManageAssignments ? 7 : 6} className="py-8 text-center text-slate-400">No cases require recontact.</TableCell></TableRow> : filteredItems.map((item) => {
                  const latestAttempt = (item.callback_history ?? []).at(-1);
                  const assignState = getAssignState(item);
                  const isEligible = ACTIVE_REVIEW_STAGES.has((item.approval_stage || "").toLowerCase());
                  return (
                    <TableRow key={item.submission_key} className="border-b border-white/10 hover:bg-white/20">
                      {canManageAssignments ? <TableCell className="pl-6 align-top"><button type="button" disabled={!isEligible} onClick={() => toggleSelected(item.submission_key)} className="flex items-center text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{selectedKeys.includes(item.submission_key) ? <CheckSquare className="h-4 w-4 text-sky-600" /> : <Square className="h-4 w-4" />}</button></TableCell> : null}
                      <TableCell className="pl-6"><button type="button" onClick={() => openDetail(item.case_id)} className="flex items-center gap-1 font-mono text-sm font-medium text-sky-700 hover:text-rose-700">{item.case_id}<ChevronRight className="h-3.5 w-3.5 shrink-0" /></button></TableCell>
                      <TableCell className="text-slate-700"><div className="text-sm">{item.ea_id ?? "—"}</div>{item.ea_name && <div className="text-xs text-slate-400">{item.ea_name}</div>}{item.lga_name && <div className="text-xs text-slate-400">{item.lga_name}</div>}{item.state_name && <div className="text-xs text-slate-400">{item.state_name}</div>}</TableCell>
                      <TableCell className="text-sm text-slate-600">{item.interviewer_id ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={cn("rounded-full text-xs", statusBadgeClass(item.approval_stage))}>{formatToken(item.approval_stage)}</Badge></TableCell>
                      <TableCell>{(item.callback_history ?? []).length === 0 ? <span className="text-xs text-slate-400">No attempts yet</span> : <div className="flex flex-col gap-1">{(item.callback_history ?? []).map((attempt) => <div key={attempt.callback_id} className="flex items-center gap-1.5"><span className="text-xs text-slate-400">#{attempt.attempt_no}</span><Badge variant="outline" className={cn("rounded-full text-xs", OUTCOME_BADGE[attempt.outcome_code] ?? "border-slate-300 bg-white/45 text-slate-700")}>{formatToken(attempt.outcome_code)}</Badge>{attempt.completed_at && <span className="text-xs text-slate-400">{formatDate(attempt.completed_at)}</span>}{attempt.assigned_to_username && <span className="text-xs text-slate-500">({attempt.assigned_to_username})</span>}</div>)}</div>}</TableCell>
                      <TableCell className="pr-6 text-right"><div className="flex items-center justify-end gap-2">{assignState === "no_attempt" && <span className="rounded-lg border border-slate-200/60 bg-slate-50/40 px-3 py-1 text-xs text-slate-500">Not pushed</span>}{assignState === "unassigned_pending" && <span className="rounded-lg border border-slate-200/60 bg-slate-50/40 px-3 py-1 text-xs text-slate-500">Unassigned pending</span>}{assignState === "others" && latestAttempt && <span className="flex items-center gap-1 rounded-lg border border-slate-200/60 bg-slate-50/40 px-3 py-1 text-xs text-slate-500"><Lock className="h-3 w-3" />{latestAttempt.assigned_to_username ? `In review by ${latestAttempt.assigned_to_username}` : "In review"}</span>}{canManageAssignments && latestAttempt?.outcome_code === "pending" && isEligible && <button type="button" onClick={() => openAssign(item)} className="flex items-center gap-1 rounded-lg border border-sky-300/40 bg-sky-50/40 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50/70"><UserCheck className="h-3 w-3" />{latestAttempt.assigned_to_user_id ? "Reassign" : "Assign"}</button>}</div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md rounded-2xl border border-white/60 p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">{modal.mode === "outcome" ? "Record Recontact Outcome" : "Manage Recontact Assignment"}</h2>
            {error && <div className="mb-4 rounded-[1rem] border border-rose-300/40 bg-rose-50/50 px-4 py-3 text-sm text-rose-700">{error}</div>}
            {modal.mode === "outcome" ? (
              <div className="space-y-4">
                <div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recontact Outcome</label><select value={outcomeCode} onChange={(e) => setOutcomeCode(e.target.value)} className="flex h-11 w-full cursor-pointer rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-ring">{OUTCOME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                <div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes (optional)</label><textarea value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} rows={3} placeholder="Add any relevant notes…" className="w-full rounded-[1.15rem] border border-white/70 bg-white/44 px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] focus:outline-none focus:ring-2 focus:ring-ring" /></div>
                <p className="text-xs text-slate-500">Record the recontact outcome here. To approve or reject the case, open the case detail page.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assign to role</label><select value={selectedRole || "PDM-QC"} disabled className="w-full rounded-[1rem] border border-white/70 bg-white/70 px-4 py-2.5 text-sm text-slate-800">{QC_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>
                <div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assign to user</label><select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} disabled={!selectedRole || loadingUsers} className="w-full rounded-[1rem] border border-white/70 bg-white/70 px-4 py-2.5 text-sm text-slate-800 disabled:opacity-60"><option value="">Select a PDM-QC user</option>{roleUsers.map((entry) => <option key={entry.user_id} value={entry.user_id}>{entry.full_name} ({entry.username})</option>)}</select></div>
                <p className="text-sm text-slate-600">Retrieve this recontact case or reassign it to another reviewer.</p>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={closeModal} className="rounded-[1rem] border border-white/50 bg-white/30 px-4 py-2 text-sm text-slate-700 hover:bg-white/50">Cancel</button>{modal.mode === "assign" ? <><button type="button" onClick={() => void handleAssignmentRemove()} disabled={saving} className="rounded-[1rem] border border-rose-300/50 bg-rose-50/60 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">{saving ? "Saving…" : "Unassign"}</button><button type="button" onClick={() => void handleAssignmentSave()} disabled={saving || !selectedUserId} className="rounded-[1rem] bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? "Saving…" : "Save Assignment"}</button></> : <button type="button" onClick={() => void handleRecordOutcome()} disabled={saving} className="rounded-[1rem] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "Saving…" : "Save Outcome"}</button>}</div>
          </div>
        </div>
      )}
      {surveyModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl">
            {surveyLoggingIn ? (
              <div className="py-8 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" />
                <p className="mt-4 text-lg font-semibold text-slate-950">Logging in...</p>
                <p className="mt-2 text-sm text-slate-500">Connecting to SurveyCTO case media.</p>
              </div>
            ) : (
              <>
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-600">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-xl font-semibold text-slate-950">SurveyCTO Login</h3>
                <p className="mt-2 text-sm text-slate-600">Enter your SurveyCTO credentials to open this recontact case.</p>
                <div className="mt-5 space-y-3">
                  <input value={surveyUsername} onChange={(e) => setSurveyUsername(e.target.value)} placeholder="SurveyCTO username" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-950" />
                  <div className="relative">
                    <input value={surveyPassword} onChange={(e) => setSurveyPassword(e.target.value)} type={showSurveyPassword ? "text" : "password"} placeholder="SurveyCTO password" className="h-11 w-full rounded-xl border border-slate-200 px-3 pr-11 text-sm text-slate-950" />
                    <button type="button" onClick={() => setShowSurveyPassword((value) => !value)} className="absolute inset-y-0 right-2 grid w-8 place-items-center text-slate-500 hover:text-slate-900" aria-label={showSurveyPassword ? "Hide password" : "Show password"}>
                      {showSurveyPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {surveyLoginError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{surveyLoginError}</div> : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => { setSurveyModalOpen(false); setPendingCaseId(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
                  <button type="button" onClick={submitSurveyLogin} disabled={!surveyUsername || !surveyPassword} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Login</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PlatformPage>
  );
}
