import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { EmptyState, PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ScrollableTable,
  ScrollableTableBody,
  ScrollableTableCell,
  ScrollableTableHead,
  ScrollableTableHeader,
  ScrollableTableRow,
} from "@/components/ui/ScrollableTable";
import { useSortedTable } from "@/hooks/useSortedTable";
import { apiFetch, type AnalysisBreakdownRow, type BreakdownState } from "@/lib/api";

const STATUS_OPTIONS = ["approved", "pending_review", "in_review", "corrected", "rejected", "submitted"];

function isBreakdownState(value: unknown): value is BreakdownState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.module === "main" || candidate.module === "listing") &&
    typeof candidate.questionLabel === "string" &&
    typeof candidate.answerLabel === "string" &&
    typeof candidate.answerCode === "string"
  );
}

function downloadBreakdownCsv(rows: AnalysisBreakdownRow[], questionLabel: string, answerLabel: string) {
  const headers = ["Submission Key", "State", "Ward Name", "Status", "Submission Date", "Interviewer ID"];
  const dataRows = rows.map((row) => [
    row.submission_key,
    row.state_name ?? "",
    row.ea_name ?? "",
    row.approval_stage ?? "",
    row.submitted_at ?? "",
    row.interviewer_id ?? "",
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`));
  const lines = [headers.join(","), ...dataRows.map((row) => row.join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `breakdown-${questionLabel.slice(0, 30)}-${answerLabel.slice(0, 20)}.csv`.replace(/\s+/g, "_");
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AnalysisBreakdownPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = isBreakdownState(location.state) ? location.state : null;

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmRow, setConfirmRow] = useState<AnalysisBreakdownRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [statusFilters, setStatusFilters] = useState<string[]>(state?.filterStatuses ?? []);
  const canEditValue = Boolean(state?.allowFreeformEdit);
  const canExportTables = Boolean(user);

  const query = useQuery({
    queryKey: [
      "analysis-answer-breakdown",
      state?.module,
      state?.sectionSlug,
      state?.questionVariable,
      state?.fieldKey,
      state?.answerCode,
      state?.isMultiSelect,
      state?.filterState,
      state?.filterEaId,
      statusFilters,
    ],
    enabled: Boolean(token && state?.answerCode),
    gcTime: 0,
    queryFn: () => {
      if (state?.module === "listing") {
        const params = new URLSearchParams({ variable: state.fieldKey!, code: state.answerCode });
        if (state.filterState) params.set("state", state.filterState);
        if (state.filterEaId) params.set("ea_id", state.filterEaId);
        return apiFetch<{ rows: AnalysisBreakdownRow[] }>(`/api/listing/answer-breakdown?${params.toString()}`, {}, token);
      }

      const params = new URLSearchParams({
        slug: state!.sectionSlug!,
        variable: state!.questionVariable!,
        code: state!.answerCode,
        is_multi: String(Boolean(state!.isMultiSelect)),
      });
      if (statusFilters.length > 0) {
        params.set("statuses", statusFilters.join(","));
      }
      return apiFetch<{ rows: AnalysisBreakdownRow[] }>(`/api/main-survey/answer-breakdown?${params.toString()}`, {}, token);
    },
  });

  const rows = query.data?.rows ?? [];
  const { sorted: sortedRows, sortKey, sortDir, handleSort } = useSortedTable(rows);

  async function submitCorrection() {
    if (!state || !confirmRow || !newValue.trim() || !canEditValue) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const endpoint = state.module === "listing"
        ? "/api/listing/analysis-corrections"
        : "/api/main-survey/analysis-corrections";
      await apiFetch(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionKey: confirmRow.submission_key,
            fieldName: state.questionVariable ?? state.fieldKey,
            oldValue: state.answerCode,
            newValue: newValue.trim(),
            questionLabel: state.questionLabel,
            correctedByUsername: user?.username,
          }),
        },
        token,
      );
      setSubmitResult("Correction applied successfully.");
      setExpandedKey(null);
      setNewValue("");
      setConfirmOpen(false);
      setConfirmRow(null);
      void query.refetch();
    } catch (error) {
      setSubmitResult(error instanceof Error ? error.message : "Failed to apply correction.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PlatformPage
      title="Analysis Breakdown"
      subtitle={state ? state.questionLabel : "Select an answer from an analysis page"}
      syncLabel=""
      module={state?.module === "listing" ? "listing" : "main"}
      plainTopBar={true}
      hideTopBar={false}
    >
      <div className="space-y-5">
        {!state ? (
          <EmptyState title="No answer selected" message="Select an answer from an analysis page to view its breakdown." />
        ) : (
          <>
            <div className="sticky top-0 z-20 space-y-4 rounded-[1.2rem] border border-white/70 bg-white/80 px-5 py-4 shadow-[0_4px_24px_rgba(148,163,184,0.12)] backdrop-blur-md">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate(state.module === "listing" ? "/listing/analysis" : `/main/${state.sectionSlug ?? ""}`)}
                  className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/44 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white/60"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {state.module === "listing" ? "Back to Listing Analysis" : "Back to Section"}
                </button>
              </div>

              <div className="rounded-[1.2rem] border border-white/70 bg-white/44 px-5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selected Answer</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{state.answerLabel}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Variable: <span className="font-mono font-semibold text-sky-700">{state.questionVariable ?? state.fieldKey}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Variable Label: <span className="font-semibold text-slate-700">{state.questionLabel}</span>
                </p>
              </div>

              {state.module === "main" ? (
                <div className="grid gap-3 md:max-w-sm">
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Status
                    </span>
                    <MultiSelectDropdown
                      label="Statuses"
                      options={STATUS_OPTIONS.map((option) => ({ value: option, label: option }))}
                      selected={statusFilters}
                      onChange={setStatusFilters}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-[1.4rem] border border-white/70 bg-white/70 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-white/60 px-5 py-3.5">
                <p className="text-sm font-semibold text-slate-800">
                  {query.isLoading ? "Loading..." : `${rows.length.toLocaleString()} submission${rows.length !== 1 ? "s" : ""}`}
                </p>
                {rows.length > 0 && canExportTables ? (
                  <button
                    type="button"
                    onClick={() => downloadBreakdownCsv(rows, state.questionLabel, state.answerLabel)}
                    className="flex items-center gap-1.5 rounded-[1rem] border border-white/70 bg-white/44 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white/70"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download CSV
                  </button>
                ) : null}
              </div>

              {query.isLoading ? (
                <div className="p-6 text-sm text-slate-500">Loading breakdown data...</div>
              ) : query.isError ? (
                <div className="p-6">
                  <EmptyState title="Error loading data" message={query.error instanceof Error ? query.error.message : "Request failed."} />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No submissions found" message="No submissions match this answer." />
                </div>
              ) : (
                <ScrollableTable maxHeight={600}>
                  <ScrollableTableHeader>
                    <tr>
                      <ScrollableTableHead onClick={() => handleSort("submission_key")} sortDir={sortKey === "submission_key" ? sortDir : null}>Submission Key</ScrollableTableHead>
                      <ScrollableTableHead onClick={() => handleSort("state_name")} sortDir={sortKey === "state_name" ? sortDir : null}>State</ScrollableTableHead>
                      <ScrollableTableHead onClick={() => handleSort("ea_name")} sortDir={sortKey === "ea_name" ? sortDir : null}>Ward Name</ScrollableTableHead>
                      <ScrollableTableHead onClick={() => handleSort("approval_stage")} sortDir={sortKey === "approval_stage" ? sortDir : null}>Status</ScrollableTableHead>
                      <ScrollableTableHead onClick={() => handleSort("submitted_at")} sortDir={sortKey === "submitted_at" ? sortDir : null}>Submission Date</ScrollableTableHead>
                      <ScrollableTableHead onClick={() => handleSort("interviewer_id")} sortDir={sortKey === "interviewer_id" ? sortDir : null}>Interviewer ID</ScrollableTableHead>
                    </tr>
                  </ScrollableTableHeader>
                  <ScrollableTableBody>
                    {sortedRows.map((row) => (
                      <Fragment key={row.submission_key}>
                        <ScrollableTableRow>
                          <ScrollableTableCell>
                            <button
                              type="button"
                              onClick={() => {
                                setSubmitResult(null);
                                setExpandedKey((previous) => (previous === row.submission_key ? null : row.submission_key));
                                setNewValue("");
                              }}
                              className="font-mono text-xs font-semibold text-sky-700 hover:underline"
                            >
                              {row.submission_key}
                            </button>
                          </ScrollableTableCell>
                          <ScrollableTableCell>{row.state_name ?? "-"}</ScrollableTableCell>
                          <ScrollableTableCell>{row.ea_name ?? "-"}</ScrollableTableCell>
                          <ScrollableTableCell>{row.approval_stage ?? "-"}</ScrollableTableCell>
                          <ScrollableTableCell className="tabular-nums text-xs">{row.submitted_at ?? "-"}</ScrollableTableCell>
                          <ScrollableTableCell className="font-mono text-xs">{row.interviewer_id ?? "-"}</ScrollableTableCell>
                        </ScrollableTableRow>
                        {expandedKey === row.submission_key && (
                          <tr className="bg-slate-50/40">
                            <td colSpan={6} className="p-4">
                              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-500">Variable: <span className="font-mono font-semibold text-slate-700">{state.questionVariable ?? state.fieldKey}</span></p>
                                <p className="text-xs text-slate-500">Question: <span className="font-semibold text-slate-700">{state.questionLabel}</span></p>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="space-y-1.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Old value</p>
                                    <Input value={state.answerLabel} readOnly placeholder="Old value" className="border-amber-300 bg-amber-50/40 text-amber-900 ring-1 ring-amber-200" />
                                    {state.answerCode !== state.answerLabel ? (
                                      <p className="text-[11px] text-slate-500">Stored code: <span className="font-mono text-slate-700">{state.answerCode}</span></p>
                                    ) : null}
                                  </div>
                                  <div className="space-y-1.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">New value</p>
                                    <Input value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder={canEditValue ? "New numeric value" : "Editing disabled for this question type"} disabled={!canEditValue} className="border-emerald-300 bg-emerald-50/30 text-emerald-950 ring-1 ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60" />
                                  </div>
                                </div>
                                {!canEditValue ? (
                                  <p className="text-xs text-amber-700">Only numeric questions can accept a new value here. Single-select and multi-select answers are read-only.</p>
                                ) : null}
                                <Button
                                  type="button"
                                  disabled={!newValue.trim() || !canEditValue}
                                  onClick={() => {
                                    setConfirmRow(row);
                                    setConfirmOpen(true);
                                  }}
                                >
                                  Submit Correction
                                </Button>
                                {submitResult ? <p className="text-xs text-slate-600">{submitResult}</p> : null}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </ScrollableTableBody>
                </ScrollableTable>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Answer Value Correction</DialogTitle>
            <DialogDescription>Confirm correction request details before submission.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm text-slate-700">
            <p><strong>Question:</strong> {state?.questionLabel}</p>
            <p><strong>Variable:</strong> {state?.questionVariable ?? state?.fieldKey}</p>
            <p><strong>Old Value:</strong> {state?.answerLabel}</p>
            {state?.answerCode && state.answerCode !== state.answerLabel ? <p><strong>Stored Code:</strong> {state.answerCode}</p> : null}
            <p><strong>New Value:</strong> {newValue}</p>
            <p><strong>Corrected by:</strong> {user?.username ?? "Unknown"}</p>
            <p><strong>Date & Time:</strong> {new Date().toLocaleString()}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button disabled={submitting || !newValue.trim() || !confirmRow || !canEditValue} onClick={() => void submitCorrection()}>
              {submitting ? "Submitting..." : "Approve Correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformPage>
  );
}
