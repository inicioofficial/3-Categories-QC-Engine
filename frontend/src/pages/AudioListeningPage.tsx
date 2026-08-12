import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Headphones, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Square, CheckSquare, UserCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { PlatformPage, SELECT_CLASS, formatDate, formatToken } from "@/app/platform-page";
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

const STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/12 text-amber-700",
  reviewed: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700",
};

interface AudioReview {
  audio_id: string;
  case_id: string;
  submission_key: string;
  case_label?: string | null;
  region_label?: string | null;
  audio_url: string | null;
  status: string;
  quality_rating: string | null;
  reviewer_note: string | null;
  assigned_to_user_id: string | null;
  assigned_to_username: string | null;
  reviewed_at: string | null;
  created_at: string;
  start_time?: string | null;
  ea_name: string | null;
  lga_name: string | null;
  state_name: string | null;
  selected_panel_labels: string | null;
  qc_flag_count?: number | null;
  interviewer_id: string | null;
  approval_stage?: string | null;
}

const ACTIVE_REVIEW_STAGES = new Set(["pending_review", "in_review"]);
const AUDIO_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function matchesAudioStatusFilter(item: AudioReview, selectedStatuses: string[]) {
  if (!selectedStatuses.length) return true;
  const listeningStatus = (item.status ?? "").toLowerCase();
  const approvalStage = (item.approval_stage ?? "").toLowerCase();
  return selectedStatuses.some((status) => {
    if (status === "approved") return approvalStage === "approved" || approvalStage === "reviewed_approved";
    if (status === "rejected") return approvalStage === "rejected" || approvalStage === "reviewed_rejected";
    return listeningStatus === status;
  });
}

export function AudioListeningPage() {
  const { token, user, selectedWorkspace } = useAuth();
  const workspace = getSurveyWorkspace(selectedWorkspace);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<AudioReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignmentModal, setAssignmentModal] = useState<AudioReview | null>(null);
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [roleUsers, setRoleUsers] = useState<{ user_id: string; username: string; full_name: string }[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
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
    const returnTo = `/main/audio-listening${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    navigate(`/main/audio-listening/${encodeURIComponent(caseId)}/detail`, {
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

  async function loadAudioReviews() {
    setLoading(true);
    try {
      const payload = await apiFetch<{ items: AudioReview[] }>("/api/main-survey/audio-listening", {}, token, 45000);
      setItems(payload.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAudioReviews(); }, [token]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (statusFilter.length) next.set("status", statusFilter.join(","));
    if (search.trim()) next.set("search", search.trim());
    if (dateFrom) next.set("date_from", dateFrom);
    if (dateTo) next.set("date_to", dateTo);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [statusFilter, search, dateFrom, dateTo, searchParams, setSearchParams]);

  const stats = {
    total: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    reviewed: items.filter((i) => i.status === "reviewed").length,
  };
  const activeQcUsers = new Set(items.map((item) => item.assigned_to_user_id || item.assigned_to_username).filter(Boolean)).size;

  async function loadUsersByRole(role: string) {
    if (!role) { setRoleUsers([]); return; }
    setLoadingUsers(true);
    try {
      const payload = await apiFetch<{ users: { user_id: string; username: string; full_name: string }[] }>(
        `/api/admin/users/by-role/${encodeURIComponent(role)}`,
        {},
        token,
        30000,
      );
      setRoleUsers(payload.users ?? []);
    } catch { setRoleUsers([]); } finally { setLoadingUsers(false); }
  }

  useEffect(() => { if (assignmentModal && selectedRole) void loadUsersByRole(selectedRole); else setRoleUsers([]); }, [assignmentModal, selectedRole, token]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesAudioStatusFilter(item, statusFilter)) return false;
      const shortDate = item.created_at ? String(item.created_at).slice(0, 10) : "";
      if (dateFrom && (!shortDate || shortDate < dateFrom)) return false;
      if (dateTo && (!shortDate || shortDate > dateTo)) return false;
      return matchesSearchTerm(item, term, [
        item.case_label,
        item.region_label,
        item.status ? formatToken(item.status) : null,
        item.approval_stage ? formatToken(item.approval_stage) : null,
        item.assigned_to_username ? null : "Unassigned",
        formatDate(item.start_time ?? item.created_at),
      ]);
    });
  }, [items, statusFilter, search, dateFrom, dateTo]);
  const queueCaseIds = filteredItems.map((i) => i.case_id);
  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (statusFilter.length) chips.push(`Status: ${statusFilter.map(formatToken).join(", ")}`);
    if (search.trim()) chips.push(`Search: ${search.trim()}`);
    if (dateFrom || dateTo) chips.push(`Date: ${dateFrom || "..."} to ${dateTo || "..."}`);
    return chips;
  }, [dateFrom, dateTo, search, statusFilter]);

  const eligibleVisibleKeys = useMemo(() => filteredItems.filter((item) => item.status === "pending" && ACTIVE_REVIEW_STAGES.has((item.approval_stage || "").toLowerCase())).map((item) => item.submission_key), [filteredItems]);
  const allVisibleSelected = eligibleVisibleKeys.length > 0 && eligibleVisibleKeys.every((key) => selectedKeys.includes(key));

  useEffect(() => { setSelectedKeys((prev) => prev.filter((key) => items.some((item) => item.submission_key === key))); }, [items]);
  function toggleSelected(key: string) { setSelectedKeys((prev) => prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]); }
  function toggleSelectAllVisible() { if (allVisibleSelected) setSelectedKeys((prev) => prev.filter((key) => !eligibleVisibleKeys.includes(key))); else setSelectedKeys((prev) => Array.from(new Set([...prev, ...eligibleVisibleKeys]))); }

  function openAssignmentModal(item: AudioReview) {
    setAssignmentModal(item); setSelectedRole("PDM-QC"); setSelectedUserId(item.assigned_to_user_id ?? ""); setAssignmentError("");
  }
  function closeAssignmentModal() { setAssignmentModal(null); setSelectedRole(""); setSelectedUserId(""); setAssignmentError(""); setRoleUsers([]); }

  async function saveAssignment() {
    if (!assignmentModal) return;
    setSavingAssignment(true); setAssignmentError("");
    try {
      await apiFetch(
        "/api/main-survey/audio-listening/assign",
        {
          method: "POST",
          body: JSON.stringify({
            case_id: assignmentModal.case_id,
            assigned_to_role: selectedRole || null,
            assigned_to_user_id: selectedUserId || null,
          }),
        },
        token,
        45000,
      );
      await loadAudioReviews();
      closeAssignmentModal();
    } catch (e: unknown) { setAssignmentError(e instanceof Error ? e.message : "Failed to update listening assignment."); } finally { setSavingAssignment(false); }
  }

  async function unassignAudio() {
    if (!assignmentModal) return;
    setSavingAssignment(true); setAssignmentError("");
    try {
      await apiFetch(`/api/main-survey/audio-listening/${encodeURIComponent(assignmentModal.audio_id)}/unassign`, { method: "POST" }, token, 45000);
      await loadAudioReviews();
      closeAssignmentModal();
    } catch (e: unknown) { setAssignmentError(e instanceof Error ? e.message : "Failed to retrieve listening case."); } finally { setSavingAssignment(false); }
  }

  async function handleBulkUnassign() {
    if (!selectedKeys.length) return;
    setBulkSaving(true); setBulkMessage(null);
    try {
      const removed = selectedKeys.length;
      await apiFetch(
        "/api/main-survey/audio-listening/bulk-unassign",
        { method: "POST", body: JSON.stringify({ submission_keys: selectedKeys }) },
        token,
        45000,
      );
      setSelectedKeys([]);
      await loadAudioReviews();
      setBulkMessage(`${removed} listening case(s) retrieved.`);
    } catch (err) {
      setBulkMessage(err instanceof Error ? err.message : "Failed to retrieve listening cases.");
    } finally { setBulkSaving(false); }
  }

  function locationLabel(item: AudioReview) {
    const parts = [item.ea_name, item.lga_name ?? item.state_name].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "—";
  }

  return (
    <PlatformPage title="Silent Listening Section" subtitle="Quality assurance for recorded interviews" syncLabel={`${stats.total} cases - ${stats.pending} pending - ${stats.reviewed} reviewed`} module="main">
      <div className="space-y-6">
        <KpiStrip items={[
          { label: "Active QC users", value: activeQcUsers.toLocaleString("en-US"), tone: "blue" },
          { label: "Total tasks pushed", value: stats.total.toLocaleString("en-US"), tone: "blue" },
          { label: "Completed", value: stats.reviewed.toLocaleString("en-US"), tone: "emerald" },
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
              <DialogTitle>Silent Listening filters</DialogTitle>
            </DialogHeader>
        <Card className="glass-panel overflow-visible rounded-[1.8rem] border-white/70">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3"><SlidersHorizontal className="h-5 w-5 text-emerald-600" /><div><p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Control filters</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Narrow the listening queue by status, search, or date</h3></div></div>
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
              <div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Status</label><MultiSelectDropdown label="statuses" options={AUDIO_STATUS_OPTIONS} selected={statusFilter} onChange={setStatusFilter} /></div>
              <div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Search</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input placeholder="Case ID, Ward, LGA, State, interviewer or assignee" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" /></div></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:w-[320px]"><div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Date from</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div><div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Date to</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div></div>
            </div>
            <div className="flex justify-end"><button type="button" onClick={() => setFilterModalOpen(false)} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700">Apply</button></div>
          </CardContent>
        </Card>
          </DialogContent>
        </Dialog>

        <Card className="glass-panel rounded-[1.8rem] border-white/70 overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/60 px-6 py-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Listening Queue</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Cases pending quality review</h3></div><button type="button" onClick={() => void loadAudioReviews()} className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/60"><RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />Refresh</button></div>
            {canManageAssignments ? <div className="flex flex-wrap items-center gap-3 border-b border-white/20 px-6 py-3"><button type="button" onClick={toggleSelectAllVisible} className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/55 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white/80">{allVisibleSelected ? <CheckSquare className="h-3.5 w-3.5 text-sky-600" /> : <Square className="h-3.5 w-3.5" />}{allVisibleSelected ? "Clear visible" : "Select visible"}</button>{selectedKeys.length ? <span className="text-sm font-medium text-sky-700">{selectedKeys.length} selected</span> : null}{canUnassignCases ? <button type="button" onClick={() => void handleBulkUnassign()} disabled={!selectedKeys.length || bulkSaving} className="rounded-full border border-violet-300/40 bg-violet-50/60 px-4 py-2 text-sm font-semibold text-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{bulkSaving ? "Unassigning…" : "Unassign selected"}</button> : null}{bulkMessage ? <span className="rounded-full border border-rose-200/50 bg-rose-50/50 px-3 py-1 text-xs text-rose-700">{bulkMessage}</span> : null}</div> : null}
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filteredItems.map((item) => { const isEligible = item.status === "pending" && ACTIVE_REVIEW_STAGES.has((item.approval_stage || "").toLowerCase()); return (<article key={item.audio_id} className={cn("rounded-[1.35rem] border border-white/70 bg-white/72 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)]", selectedKeys.includes(item.submission_key) && "border-sky-300 bg-sky-50/70")}><div className="flex items-start gap-3">{canManageAssignments ? <button type="button" disabled={!isEligible} onClick={() => toggleSelected(item.submission_key)} className="mt-1 text-slate-400 hover:text-slate-700 disabled:opacity-40">{selectedKeys.includes(item.submission_key) ? <CheckSquare className="h-4 w-4 text-sky-600" /> : <Square className="h-4 w-4" />}</button> : null}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">{item.case_id}</p><h4 className="mt-1 text-lg font-semibold text-slate-950">{item.case_label || item.region_label || item.ea_name || "Listening case"}</h4><p className="mt-1 text-xs text-slate-500">Selected Panels: {item.selected_panel_labels || "Omnibus"}</p></div><Badge className={cn("border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider", STATUS_BADGE[item.status] || STATUS_BADGE.pending)}>{item.status}</Badge></div><div className="mt-4 space-y-2 text-xs text-slate-600"><div><span className="font-semibold text-slate-800">Auto-flagged QC Issues:</span> {Number(item.qc_flag_count ?? 0).toLocaleString("en-US")}</div><div><span className="font-semibold text-slate-800">Start Date/Time:</span> {formatDate(item.start_time ?? item.created_at)}</div><div><span className="font-semibold text-slate-800">Assigned to:</span> {item.assigned_to_username ?? "Unassigned"}</div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3"><div className="space-y-1 text-xs text-slate-500"><div><span className="font-semibold text-slate-700">KEY:</span> {item.submission_key}</div><div><span className="font-semibold text-slate-700">Interviewer:</span> {item.interviewer_id ?? "-"}</div></div><button type="button" onClick={() => openDetail(item.case_id)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700">Open case</button></div></div></div></article>); })}{filteredItems.length === 0 ? <div className="col-span-full py-12 text-center text-sm text-slate-500">No listening cases found.</div> : null}</div>
          </CardContent>
        </Card>
      </div>
      {assignmentModal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"><div className="glass-card w-full max-w-md rounded-2xl border border-white/60 p-6 shadow-2xl"><h2 className="mb-4 text-lg font-semibold text-slate-800">Manage Listening Assignment</h2>{assignmentError ? <div className="mb-4 rounded-[1rem] border border-rose-300/40 bg-rose-50/50 px-4 py-3 text-sm text-rose-700">{assignmentError}</div> : null}<div className="space-y-4"><div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assign to role</label><select value={selectedRole || "PDM-QC"} disabled className="w-full rounded-[1rem] border border-white/70 bg-white/70 px-4 py-2.5 text-sm text-slate-800"><option value="PDM-QC">PDM-QC</option></select></div><div className="space-y-1.5"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assign to user</label><select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} disabled={!selectedRole || loadingUsers} className="w-full rounded-[1rem] border border-white/70 bg-white/70 px-4 py-2.5 text-sm text-slate-800 disabled:opacity-60"><option value="">Select a PDM-QC user</option>{roleUsers.map((entry) => <option key={entry.user_id} value={entry.user_id}>{entry.full_name} ({entry.username})</option>)}</select></div></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={closeAssignmentModal} className="rounded-[1rem] border border-white/60 bg-white/50 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white/70">Cancel</button>{canUnassignCases ? <button type="button" onClick={() => void unassignAudio()} disabled={savingAssignment} className="rounded-[1rem] border border-rose-300/50 bg-rose-50/60 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">{savingAssignment ? "Saving..." : "Retrieve"}</button> : null}<button type="button" onClick={() => void saveAssignment()} disabled={savingAssignment || !selectedUserId} className="rounded-[1rem] bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{savingAssignment ? "Saving..." : "Save Assignment"}</button></div></div></div> : null}
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
                <p className="mt-2 text-sm text-slate-600">Enter your SurveyCTO credentials to open this silent listening case.</p>
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
