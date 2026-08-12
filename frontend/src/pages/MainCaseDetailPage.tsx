import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Flag, History, MapPin, MessageSquare, ShieldCheck, UserRound, XCircle } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { PlatformPage, formatDate, formatToken } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { apiFetch, apiFetchCached, type MainCaseDetail, type MainCaseListItem } from "@/lib/api";

type Decision = "approved" | "rejected" | "pending_review" | "in_review";

const STATUS_OPTIONS: { value: Decision; label: string }[] = [
  { value: "pending_review", label: "Pending Review" },
  { value: "in_review", label: "In Review" },
  { value: "approved", label: "Reviewed and Approved" },
  { value: "rejected", label: "Reviewed and Reject" },
];

function getText(source: Record<string, unknown>, keys: string[], fallback = "-") {
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return fallback;
}

function compactDate(value: unknown) {
  if (!value) return "-";
  return formatDate(String(value));
}

function statusPill(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("approved")) return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (normalized.includes("reject")) return "border-rose-300 bg-rose-50 text-rose-700";
  if (normalized.includes("review")) return "border-blue-300 bg-blue-50 text-blue-700";
  return "border-amber-300 bg-amber-50 text-amber-700";
}

function snapshotQuestionText(variableName: string, variableLabel: string) {
  const label = String(variableLabel || variableName).trim();
  const pattern = new RegExp(`^${variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?\\s*`, "i");
  const cleanLabel = label.replace(pattern, "").trim() || label;
  return `${variableName}. ${cleanLabel}`;
}

function DataLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/65 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={String(value)}>{value}</p>
    </div>
  );
}

function FreshSection({ title, icon: Icon, children }: { title: string; icon: typeof UserRound; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/55 shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-3 border-b border-white/70 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function MainCaseDetailPage() {
  const { token, user } = useAuth();
  const { submissionKey = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<MainCaseDetail | null>(null);
  const [queueKeys, setQueueKeys] = useState<string[]>([]);
  const [decision, setDecision] = useState<Decision>("in_review");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSnapshotPanel, setActiveSnapshotPanel] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setMessage(null);
      setDetail(null);
      try {
        const payload = await apiFetchCached<MainCaseDetail>(
          `/api/main-survey/cases/${encodeURIComponent(submissionKey)}?include_navigation=false&include_audit=false`,
          {},
          token,
          { timeoutMs: 45_000 },
        );
        if (cancelled) return;
        setDetail(payload);
        const status = String(payload.case.approval_stage ?? "in_review") as Decision;
        setDecision(STATUS_OPTIONS.some((entry) => entry.value === status) ? status : "in_review");
      } catch (error) {
        if (cancelled) return;
        setDetail(null);
        setMessage(error instanceof Error ? error.message : "Unable to load this case from the database.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [submissionKey, token]);

  useEffect(() => {
    let cancelled = false;
    async function loadNavigation() {
      try {
        const navigation = await apiFetch<Record<string, unknown>>(
          `/api/main-survey/cases/${encodeURIComponent(submissionKey)}/navigation`,
          {},
          token,
        );
        if (cancelled) return;
        setDetail((current) => current ? { ...current, case: { ...current.case, ...navigation } } : current);
      } catch {
        // Navigation metadata is non-critical; the case content should stay visible.
      }
    }
    if (submissionKey) void loadNavigation();
    return () => { cancelled = true; };
  }, [submissionKey, token]);

  useEffect(() => {
    const state = location.state as { queueSubmissionKeys?: unknown } | null;
    if (Array.isArray(state?.queueSubmissionKeys)) {
      setQueueKeys(state.queueSubmissionKeys.filter((item): item is string => typeof item === "string" && item.length > 0));
      return;
    }
    let cancelled = false;
    async function loadQueue() {
      const qs = location.search.startsWith("?") ? location.search : "";
      try {
        const payload = await apiFetch<{ items: MainCaseListItem[] }>(`/api/main-survey/cases${qs}`, {}, token);
        if (!cancelled) {
          const keys = payload.items.map((item) => item.submission_key).filter(Boolean);
          setQueueKeys(keys.length ? keys : [submissionKey]);
        }
      } catch {
        if (!cancelled) setQueueKeys([submissionKey]);
      }
    }
    void loadQueue();
    return () => { cancelled = true; };
  }, [location.search, location.state, token]);

  const caseData = useMemo(() => ((detail?.case ?? {}) as Record<string, unknown>), [detail?.case]);
  const record = useMemo(() => ((caseData.record ?? {}) as Record<string, unknown>) ?? {}, [caseData]);
  const issues = detail?.issues ?? [];
  const history = detail?.history ?? [];
  const activityTimeline = detail?.activity_timeline?.length
    ? detail.activity_timeline
    : history.map((item) => ({
        event_type: "case_status",
        title: "Case status changed",
        queue: "Main QC",
        status: item.new_status,
        event_time: item.changed_at,
        actor_name: item.changed_by_name,
        assignee_name: null,
        note: item.change_note,
      }));
  const selectedPanelBauSnapshot = detail?.selectedPanelBauSnapshot ?? [];
  const panelSnapshotGroups = useMemo(() => {
    const groups = new Map<string, { panelCode: string; panelLabel: string; items: typeof selectedPanelBauSnapshot }>();
    for (const item of selectedPanelBauSnapshot) {
      const panelCode = item.panelCode || item.panelLabel || "panel";
      const existing = groups.get(panelCode);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(panelCode, {
          panelCode,
          panelLabel: item.panelLabel || item.panelCode || "Selected panel",
          items: [item],
        });
      }
    }
    return Array.from(groups.values());
  }, [selectedPanelBauSnapshot]);
  const currentStatus = String(caseData.approval_stage ?? decision);

  const currentIndex = queueKeys.findIndex((key) => key === submissionKey);
  const previousKey = String(caseData.previous_submission_key ?? "") || (currentIndex > 0 ? queueKeys[currentIndex - 1] : null);
  const nextKey = String(caseData.next_submission_key ?? "") || (currentIndex >= 0 && currentIndex < queueKeys.length - 1 ? queueKeys[currentIndex + 1] : null);
  const overallOrdinal = Number(caseData.overall_case_ordinal ?? 0);
  const overallCount = Number(caseData.overall_case_count ?? 0);
  const pagePositionLabel = overallOrdinal && overallCount ? `${overallOrdinal} / ${overallCount}` : currentIndex >= 0 ? `${currentIndex + 1} / ${queueKeys.length}` : "1 / 1";
  const regionLabel = getText(caseData, ["region_label", "state_name"], getText(record, ["City_1", "state", "state_name", "lga_name"], "Region")).replace(/\s+/g, "_");
  const regionOrdinal = Number(caseData.region_respondent_ordinal ?? 0);
  const hasRegionOrdinal = Number.isFinite(regionOrdinal) && regionOrdinal > 0 && caseData.region_respondent_ordinal != null;
  const regionCaseTitle = hasRegionOrdinal
    ? `${regionLabel}_Resp._${regionOrdinal}`
    : getText(caseData, ["case_id"], "Loading case label...");
  const activeSnapshotGroup = panelSnapshotGroups.find((group) => group.panelCode === activeSnapshotPanel) ?? panelSnapshotGroups[0] ?? null;

  useEffect(() => {
    if (!panelSnapshotGroups.length) {
      setActiveSnapshotPanel("");
      return;
    }
    if (!panelSnapshotGroups.some((group) => group.panelCode === activeSnapshotPanel)) {
      setActiveSnapshotPanel(panelSnapshotGroups[0].panelCode);
    }
  }, [activeSnapshotPanel, panelSnapshotGroups]);

  const profile = {
    caseId: getText(caseData, ["case_id"], submissionKey),
    state: getText(caseData, ["state_name"], getText(record, ["state", "state_name"])),
    interviewer: getText(caseData, ["interviewer_id"], getText(record, ["interviewer_id"])),
    selectedPanels: getText(caseData, ["selected_panel_labels"], "Omnibus"),
    submitted: compactDate(caseData.submitted_at ?? record.submission_date),
    city: getText(caseData, ["region_label"], getText(record, ["City_1", "city"], "-")),
    surveyMonth: getText(caseData, ["survey_month"], getText(record, ["survey_month"], "-")),
  };

  function goTo(targetKey: string | null) {
    if (!targetKey) return;
    navigate({ pathname: `/main/cases/${encodeURIComponent(targetKey)}`, search: location.search }, { state: { queueSubmissionKeys: queueKeys } });
  }

  async function submitDecision(nextDecision = decision) {
    try {
      await apiFetch(`/api/main-survey/cases/${encodeURIComponent(submissionKey)}/status`, {
        method: "POST",
        body: JSON.stringify({ status: nextDecision, note }),
      }, token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save status.");
      return;
    }
    setDecision(nextDecision);
    setMessage(`Case moved to ${formatToken(nextDecision)}.`);
  }

  const canEdit = Boolean(user);

  return (
    <PlatformPage title="Main Data - Individual selected case" subtitle="" syncLabel="" module="main">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to={`/main/cases${location.search}`} className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/55 px-4 py-2 text-sm font-black text-slate-700 hover:bg-white">
            <ArrowLeft className="h-4 w-4" />
            Main Data Explorer
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!previousKey} onClick={() => goTo(previousKey)} className="rounded-full border border-white/70 bg-white/55 px-4 py-2 text-xs font-black text-slate-700 disabled:opacity-40">Previous</button>
            <span className="rounded-full bg-blue-600 px-4 py-2 text-xs font-black text-white">Page {pagePositionLabel}</span>
            <button type="button" disabled={!nextKey} onClick={() => goTo(nextKey)} className="rounded-full border border-white/70 bg-white/55 px-4 py-2 text-xs font-black text-slate-700 disabled:opacity-40">Next</button>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-br from-white/80 via-sky-50/70 to-emerald-50/70 p-6 shadow-[0_30px_90px_rgba(14,165,233,0.14)]">
          <div className="absolute right-8 top-6 hidden h-32 w-32 rounded-full bg-blue-500/10 blur-2xl md:block" />
          <div className="relative grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusPill(currentStatus)}`}>{formatToken(currentStatus)}</span>
                <span className="rounded-full border border-slate-300 bg-white/60 px-3 py-1 text-xs font-black text-slate-600">{profile.state}</span>
              </div>
              <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-normal text-slate-950 md:text-4xl">{regionCaseTitle}</h1>
              <p className="mt-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">{profile.caseId}</p>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Case-level quality desk for a 3 Categories QC Platform interview, combining respondent details, selected panels, QC findings, and review decision in one command view.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DataLine label="Region" value={profile.city} />
                <DataLine label="Interviewer" value={profile.interviewer} />
                <DataLine label="Submission Date/Time" value={profile.submitted} />
                <DataLine label="Selected Panels" value={profile.selectedPanels} />
                <DataLine label="Survey Month" value={profile.surveyMonth} />
                <DataLine label="Status" value={formatToken(currentStatus)} />
                <DataLine label="Submission Key" value={String(caseData.submission_key ?? submissionKey)} />
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/75 bg-white/42 p-5 text-slate-950 shadow-[0_24px_70px_rgba(37,99,235,0.16)] backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-white">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-700">Review decision</p>
                  <h2 className="text-xl font-black">Set final QC outcome</h2>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <select value={decision} onChange={(event) => setDecision(event.target.value as Decision)} className="h-11 w-full rounded-2xl border border-white/70 bg-white/78 px-3 text-sm font-semibold text-slate-950 outline-none">
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value} className="text-slate-900">{option.label}</option>)}
                </select>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write a QC note for this case..." className="min-h-24 w-full rounded-2xl border border-white/70 bg-white/78 px-3 py-3 text-sm text-slate-950 placeholder:text-slate-500 outline-none" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={!canEdit} onClick={() => void submitDecision("approved")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white disabled:opacity-45">
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button type="button" disabled={!canEdit} onClick={() => void submitDecision("rejected")} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-black text-white disabled:opacity-45">
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </div>
                {message ? <p className="rounded-2xl border border-blue-200 bg-blue-50/80 px-3 py-2 text-xs font-semibold text-blue-700">{message}</p> : null}
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
          <FreshSection title="QC findings" icon={Flag}>
            {loading ? <p className="text-sm text-slate-500">Loading case findings...</p> : null}
            {!loading && !issues.length ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-700">No open QC findings on this case.</div>
            ) : null}
            <div className="space-y-3">
              {issues.slice(0, 8).map((issue) => (
                <div key={issue.issue_id} className="rounded-2xl border border-slate-200/80 bg-white/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm font-black text-slate-900">{issue.issue_summary}</p>
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">{formatToken(issue.severity ?? "review")}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{issue.rule_code ? `${issue.rule_code} - ` : ""}{issue.field_name ?? "Case-level signal"}</p>
                  {issue.matching_cases?.length ? (
                    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">Other affected cases</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {issue.matching_cases.map((match) => (
                          <Link
                            key={match.submission_key}
                            to={{ pathname: `/main/cases/${encodeURIComponent(match.submission_key)}`, search: location.search }}
                            state={{ queueSubmissionKeys: queueKeys }}
                            className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-black text-amber-800 hover:bg-amber-100"
                          >
                            {match.case_label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </FreshSection>

          <FreshSection title="Activity timeline" icon={Clock3}>
            <div className="space-y-3">
              {activityTimeline.slice(0, 12).map((item, index) => (
                <div key={`${item.event_time}-${item.event_type}-${index}`} className="flex gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-4">
                  <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-white">
                    <History className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-slate-900">{item.title || formatToken(item.status ?? "status update")}</p>
                        <p className="mt-1 text-xs font-semibold text-sky-700">{item.queue}</p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${statusPill(String(item.status ?? "pending"))}`}>
                        {formatToken(item.status ?? "pending")}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      <p><span className="font-semibold text-slate-700">Time:</span> {compactDate(item.event_time)}</p>
                      <p><span className="font-semibold text-slate-700">Assignee:</span> {item.assignee_name || "Unassigned"}</p>
                      {item.actor_name ? <p><span className="font-semibold text-slate-700">Actor:</span> {item.actor_name}</p> : null}
                    </div>
                    {item.note ? <p className="mt-2 text-xs leading-5 text-slate-600">{item.note}</p> : null}
                  </div>
                </div>
              ))}
              {!activityTimeline.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No callback, audio, or status events have been recorded for this case.</p> : null}
            </div>
          </FreshSection>
        </div>

        <FreshSection title="Survey section snapshot" icon={MessageSquare}>
          {panelSnapshotGroups.length ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {panelSnapshotGroups.map((group) => {
                  const active = group.panelCode === activeSnapshotGroup?.panelCode;
                  return (
                    <button
                      key={group.panelCode}
                      type="button"
                      onClick={() => setActiveSnapshotPanel(group.panelCode)}
                      className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                        active
                          ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                          : "border-slate-200 bg-white/75 text-slate-700 hover:border-blue-300 hover:text-blue-700"
                      }`}
                    >
                      {group.panelLabel}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {activeSnapshotGroup?.items.map((item) => (
                  <div key={`${item.panelCode}-${item.variableName}`} className="rounded-2xl border border-slate-200/80 bg-white/75 p-4">
                    <p className="text-sm font-black leading-6 text-slate-950">
                      {snapshotQuestionText(item.variableName, item.variableLabel)}
                    </p>
                    <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 px-3 py-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Recorded answer</p>
                      <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{item.value || "-"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 p-5 text-sm text-slate-500">
                <MapPin className="mb-3 h-5 w-5 text-blue-600" />
                No BAU1a or BAU5a values were found for the selected panels on this case.
              </div>
          )}
        </FreshSection>

        <div className="flex items-center justify-center gap-2">
          <button type="button" disabled={!previousKey} onClick={() => goTo(previousKey)} className="rounded-full border border-white/70 bg-white/55 px-4 py-2 text-xs font-black text-slate-700 disabled:opacity-40">Previous</button>
          <span className="rounded-full bg-blue-600 px-4 py-2 text-xs font-black text-white">Page {pagePositionLabel}</span>
          <button type="button" disabled={!nextKey} onClick={() => goTo(nextKey)} className="rounded-full border border-white/70 bg-white/55 px-4 py-2 text-xs font-black text-slate-700 disabled:opacity-40">Next</button>
        </div>
      </div>
    </PlatformPage>
  );
}
