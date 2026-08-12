import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckSquare, Download, Filter, Headphones, PhoneCall, Search, ShieldAlert, SlidersHorizontal, Square, ThumbsUp, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { PlatformPage, SELECT_CLASS, formatDate, formatToken, statusBadgeClass, truncateValue } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableTable, ScrollableTableHeader } from "@/components/ui/ScrollableTable";
import { apiFetch, type MainCaseListItem, type MainCaseListResponse } from "@/lib/api";
import { BHT_CATEGORY_FILTER_OPTIONS, getBhtCategory } from "@/data/bhtCategories";
import { exportRowsToExcel } from "@/lib/exportExcel";
import { cn } from "@/lib/utils";

function summaryValue(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function mainApprovalDisplayLabel(item: MainCaseListItem) {
  if (item.approval_stage === "approved" || item.approval_stage === "reviewed_approved") return "Reviewed and Approved";
  if (item.approval_stage === "rejected" || item.approval_stage === "reviewed_rejected") return "Reviewed and Reject";
  return item.approval_stage === "approved" && item.is_auto_approved ? "Auto Approved" : formatToken(item.approval_stage);
}

function selectedPanelLabel(item: MainCaseListItem) {
  return item.selected_panel_labels?.trim() || "Omnibus";
}

function assignmentLabel(item: MainCaseListItem) {
  const callbackName = item.callback_assigned_to_name?.trim();
  const audioName = item.audio_assigned_to_name?.trim();
  if (callbackName && audioName && callbackName !== audioName) return `${callbackName} | ${audioName}`;
  if (callbackName) return callbackName;
  if (audioName) return audioName;
  return "Unassigned";
}

function caseRegionLabel(item: MainCaseListItem) {
  const raw = item.region_label?.trim() || item.state_name?.trim() || item.lga_name?.trim() || "Region";
  return raw.toLowerCase() === "unknown" ? "Region" : raw.replace(/\s+/g, "_");
}

const EMPTY_MAIN_CASES: MainCaseListItem[] = [];
const MAIN_CASES_PAGE_SIZE = 50;
const MAIN_CASE_STATUS_OPTIONS = [
  { value: "approved", label: "Reviewed and Approved" },
  { value: "rejected", label: "Reviewed and Reject" },
  { value: "pending_review", label: "Pending Review" },
  { value: "in_review", label: "In Review" },
  { value: "submitted", label: "Submitted" },
];
const MAIN_CASE_STATUS_LABELS = Object.fromEntries(MAIN_CASE_STATUS_OPTIONS.map((option) => [option.value, option.label]));
const MAIN_CASE_QUEUE_OPTIONS = [
  { value: "callback", label: "Respondent Recontact" },
  { value: "audio", label: "Silent Listening" },
];
const MAIN_CASE_ASSIGNMENT_OPTIONS = [
  { value: "assigned", label: "Any assigned" },
  { value: "unassigned", label: "Any unassigned" },
  { value: "callback_assigned", label: "Recontact assigned" },
  { value: "audio_assigned", label: "Silent listening assigned" },
];
const MAIN_CASE_ASSIGNMENT_LABELS = Object.fromEntries(MAIN_CASE_ASSIGNMENT_OPTIONS.map((option) => [option.value, option.label]));

const MAIN_QC_RULE_LABELS: Record<string, string> = {
  MAIN_LOW_LOI: "Low LOI",
  MAIN_HIGH_LOI: "High LOI",
  MAIN_START_TIME: "Odd Hour",
  MAIN_DUPLICATE_PHONE_NUMBER: "Duplicate Phone Number",
  MAIN_DUPLICATE_PHONE_NUMBER_GLOBAL: "Duplicate Phone Number - Dataset",
  MAIN_DUPLICATE_GPS: "Duplicate GPS",
  MAIN_GAP_BETWEEN_2_INTERVIEWS: "Gap between 2 interviews",
  MAIN_TIME_INTERWOVEN: "Time interwoven",
  MAIN_STRAIGHTLINING: "Straightlining",
};

type BulkAction = "approve" | "unapprove" | "callback" | "delete" | "audio" | "unassign_callback" | "unassign_audio";
type BulkState = { action: BulkAction; saving: boolean; result: string | null };
type PushModalType = "callback" | "audio" | null;
type AssignmentConfirmState = { action: "callback" | "audio"; role: string; userId: string; assigned: number; unassignedKeys: string[] } | null;

const QC_ROLES = [
  { value: "PDM-QC", label: "PDM-QC" },
] as const;

type MainCaseRowProps = {
  item: MainCaseListItem;
  canBulkSelect: boolean;
  isSelected: boolean;
  onToggle: (key: string) => void;
  detailQueryString: string;
  queueSubmissionKeys: string[];
};

const MainCaseRow = memo(function MainCaseRow({
  item,
  canBulkSelect,
  isSelected,
  onToggle,
  detailQueryString,
  queueSubmissionKeys,
}: MainCaseRowProps) {
  const qcFlags = Number((item as MainCaseListItem & { qc_flag_count?: number }).qc_flag_count ?? 0);
  const issueCount = Math.max(item.open_issue_count, qcFlags);
  const totalLoad = issueCount;
  const loadTone = totalLoad >= 5 ? "text-rose-700" : totalLoad >= 2 ? "text-amber-700" : "text-emerald-700";

  return (
    <TableRow className={cn("border-white/50 transition-colors hover:bg-white/30", isSelected && canBulkSelect ? "bg-sky-50/40 hover:bg-sky-50/60" : "")}>
      {canBulkSelect ? (
        <TableCell className="w-10 py-4 pl-4 align-top">
          <button type="button" onClick={() => onToggle(item.submission_key)} className="flex items-center text-slate-400 hover:text-slate-700">
            {isSelected ? <CheckSquare className="h-4 w-4 text-sky-600" /> : <Square className="h-4 w-4" />}
          </button>
        </TableCell>
      ) : null}
      <TableCell className="py-4 align-top">
        <Link to={{ pathname: `/main/cases/${encodeURIComponent(item.submission_key)}`, search: detailQueryString }} state={{ queueSubmissionKeys }} className="inline-flex flex-col gap-1">
          <span className="font-mono text-xs text-sky-700 transition-colors hover:text-rose-700">{truncateValue(item.case_id ?? item.submission_key, 22)}</span>
          <span className="text-xs text-slate-500">Open case workspace</span>
        </Link>
      </TableCell>
      <TableCell className="py-4 align-top">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span>{item.ea_name ?? item.ea_id ?? "-"}</span>
            {item.has_callback_history ? (
              <span className="inline-flex items-center rounded-full border border-amber-300/50 bg-amber-50/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="This case has been pushed to Respondent Recontact Section before.">
                <PhoneCall className="h-3 w-3" />
              </span>
            ) : null}
            {item.has_audio_history ? (
              <span className="inline-flex items-center rounded-full border border-violet-300/50 bg-violet-50/70 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700" title="This case has been pushed to Silent Listening Section before.">
                <Headphones className="h-3 w-3" />
              </span>
            ) : null}
          </div>
          <div className="text-xs font-medium text-slate-600"><span className="font-bold text-slate-700">Selected Panels:</span> {selectedPanelLabel(item)}</div>
          <div className="font-mono text-[11px] text-slate-500">{item.ea_id ?? "-"}</div>
        </div>
      </TableCell>
      <TableCell className="py-4 align-top">
        <span className="text-sm text-slate-700">{item.state_name ?? "-"}</span>
      </TableCell>
      <TableCell className="py-4 align-top">
        <span className="text-sm text-slate-700">{item.approved_by ?? "-"}</span>
      </TableCell>
      <TableCell className="py-4 align-top">
        <Badge variant="outline" className={`border text-[11px] font-medium ${statusBadgeClass(item.approval_stage)}`}>
          {mainApprovalDisplayLabel(item)}
        </Badge>
      </TableCell>
      <TableCell className="py-4 align-top">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-700">{item.section_count} sections</span>
        </div>
      </TableCell>
      <TableCell className="py-4 align-top">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-rose-500" />
          <div>
            <p className={`text-sm font-semibold ${loadTone}`}>{totalLoad} active items</p>
            <p className="text-xs text-slate-500">{issueCount} unresolved QC issues</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-4 align-top">
        {(() => {
          const val = item.supacc_confirm?.toLowerCase();
          const yes = val === "yes" || val === "1" || val === "true";
          return (
            <span className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-semibold",
              yes
                ? "border-emerald-400/40 bg-emerald-50/60 text-emerald-700"
                : "border-slate-300/50 bg-slate-100/50 text-slate-500",
            )}>
              {yes ? "Yes" : "No"}
            </span>
          );
        })()}
      </TableCell>
      <TableCell className="py-4 align-top">
        <span className="text-sm text-slate-700">{item.slot_type ? formatToken(item.slot_type) : "-"}</span>
      </TableCell>
      <TableCell className="py-4 align-top">
        <span className="text-sm text-slate-700">{item.username ?? "-"}</span>
      </TableCell>
      <TableCell className="py-4 align-top">
        <span className="text-sm text-slate-700">{item.final_outcome_code ? formatToken(item.final_outcome_code) : "-"}</span>
      </TableCell>
      <TableCell className="py-4 align-top">
        <div className="text-sm text-slate-700">{formatDate(item.submitted_at)}</div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">{truncateValue(item.interviewer_id ?? "-", 18)}</div>
      </TableCell>
    </TableRow>
  );
});

export function MainCasesPage() {
  const { token, user, selectedCategory } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategoryFilters = (searchParams.get("category") ?? "").split(",").filter(Boolean);
  const defaultCategoryFilters = initialCategoryFilters.length ? initialCategoryFilters : selectedCategory && selectedCategory !== "all" ? [selectedCategory] : [];
  const [statusFilters, setStatusFilters] = useState<string[]>(() => (searchParams.get("status") ?? "").split(",").filter(Boolean));
  const [categoryFilters, setCategoryFilters] = useState<string[]>(() => defaultCategoryFilters);
  const [cityFilters, setCityFilters] = useState<string[]>(() => (searchParams.get("cities") ?? "").split(",").filter(Boolean));
  const [interviewerFilters, setInterviewerFilters] = useState<string[]>(() => (searchParams.get("interviewers") ?? "").split(",").filter(Boolean));
  const [queueFilters, setQueueFilters] = useState<string[]>(() => (searchParams.get("queue") ?? "").split(",").filter(Boolean));
  const [assignmentFilters, setAssignmentFilters] = useState<string[]>(() => (searchParams.get("assignment") ?? "").split(",").filter(Boolean));
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [bulkSearchOpen, setBulkSearchOpen] = useState(false);
  const [bulkSearchDraft, setBulkSearchDraft] = useState(() => {
    const initialSearch = searchParams.get("search") ?? "";
    return initialSearch.includes("\n") ? initialSearch : "";
  });
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("date_to") ?? "");
  const initialQcRules = (searchParams.get("qc_rule") ?? "").split(",").filter(Boolean);
  const [appliedFilters, setAppliedFilters] = useState(() => ({
    statuses: (searchParams.get("status") ?? "").split(",").filter(Boolean),
    categories: defaultCategoryFilters,
    cities: (searchParams.get("cities") ?? "").split(",").filter(Boolean),
    interviewers: (searchParams.get("interviewers") ?? "").split(",").filter(Boolean),
    queues: (searchParams.get("queue") ?? "").split(",").filter(Boolean),
    assignments: (searchParams.get("assignment") ?? "").split(",").filter(Boolean),
    qcRules: initialQcRules,
    search: searchParams.get("search") ?? "",
    dateFrom: searchParams.get("date_from") ?? "",
    dateTo: searchParams.get("date_to") ?? "",
  }));
  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get("page") ?? "1");
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  });
  const deferredSearch = useDeferredValue(search.trim());
  const bulkSearchTerms = useMemo(
    () => Array.from(new Set(bulkSearchDraft.split(/\r?\n/).map((term) => term.trim()).filter(Boolean))),
    [bulkSearchDraft],
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [pushModalType, setPushModalType] = useState<PushModalType>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [roleUsers, setRoleUsers] = useState<{ user_id: string; username: string; full_name: string }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [caseItems, setCaseItems] = useState<MainCaseListItem[]>([]);
  const [filterOptions, setFilterOptions] = useState<{ cities: string[]; interviewers: string[] }>({ cities: [], interviewers: [] });
  const [totalCaseCount, setTotalCaseCount] = useState(0);
  const [totalOpenIssueCount, setTotalOpenIssueCount] = useState(0);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [assignmentConfirm, setAssignmentConfirm] = useState<AssignmentConfirmState>(null);
  const [sortKey, setSortKey] = useState<string>(() => searchParams.get("sort_by") ?? "submitted_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (searchParams.get("sort_dir") === "asc" ? "asc" : "desc"));
  const selectedCategoryLabels = categoryFilters
    .map((slug) => getBhtCategory(slug).label)
    .join(", ");
  const categorySummary = categoryFilters.length ? selectedCategoryLabels : "All Categories";
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; tone?: "rose" }> = [];
    if (appliedFilters.search) {
      const searchCount = appliedFilters.search.split(/\r?\n/).map((term) => term.trim()).filter(Boolean).length;
      chips.push({
        key: "search",
        label: searchCount > 1 ? `Bulk search: ${searchCount} terms` : `Search: ${appliedFilters.search}`,
      });
    }
    if (appliedFilters.categories.length) {
      chips.push({ key: "categories", label: `Categories: ${appliedFilters.categories.map((slug) => getBhtCategory(slug).label).join(", ")}` });
    }
    if (appliedFilters.statuses.length) chips.push({ key: "statuses", label: `Status: ${appliedFilters.statuses.map((status) => MAIN_CASE_STATUS_LABELS[status] ?? formatToken(status)).join(", ")}` });
    if (appliedFilters.cities.length) chips.push({ key: "cities", label: `City: ${appliedFilters.cities.join(", ")}` });
    if (appliedFilters.interviewers.length) chips.push({ key: "interviewers", label: `Interviewer: ${appliedFilters.interviewers.join(", ")}` });
    if (appliedFilters.queues.length) chips.push({ key: "queues", label: `Queue: ${appliedFilters.queues.map((value) => value === "callback" ? "Respondent Recontact" : "Silent Listening").join(", ")}` });
    if (appliedFilters.assignments.length) chips.push({ key: "assignments", label: `Assignment: ${appliedFilters.assignments.map((value) => MAIN_CASE_ASSIGNMENT_LABELS[value] ?? formatToken(value)).join(", ")}` });
    if (appliedFilters.dateFrom || appliedFilters.dateTo) chips.push({ key: "dates", label: `Date: ${appliedFilters.dateFrom || "..."} to ${appliedFilters.dateTo || "..."}` });
    if (appliedFilters.qcRules.length) {
      chips.push({ key: "qcRules", label: `QC flag: ${appliedFilters.qcRules.map((rule) => MAIN_QC_RULE_LABELS[rule] ?? formatToken(rule)).join(", ")}`, tone: "rose" });
    }
    return chips;
  }, [appliedFilters]);

  const requestQueryString = useMemo(() => {
    const query = new URLSearchParams();
    if (appliedFilters.statuses.length) query.set("status", appliedFilters.statuses.join(","));
    if (appliedFilters.search && !appliedFilters.search.includes("\n")) query.set("search", appliedFilters.search);
    if (appliedFilters.dateFrom) query.set("date_from", appliedFilters.dateFrom);
    if (appliedFilters.dateTo) query.set("date_to", appliedFilters.dateTo);
    if (appliedFilters.categories.length) query.set("category", appliedFilters.categories.join(","));
    if (appliedFilters.cities.length) query.set("cities", appliedFilters.cities.join(","));
    if (appliedFilters.interviewers.length) query.set("interviewers", appliedFilters.interviewers.join(","));
    if (appliedFilters.queues.length) query.set("queue", appliedFilters.queues.join(","));
    if (appliedFilters.assignments.length) query.set("assignment", appliedFilters.assignments.join(","));
    if (appliedFilters.qcRules.length) query.set("qc_rule", appliedFilters.qcRules.join(","));
    query.set("sort_by", sortKey);
    query.set("sort_dir", sortDir);
    query.set("page_size", String(MAIN_CASES_PAGE_SIZE));
    query.set("page", String(page));
    return query.toString();
  }, [appliedFilters, page, sortDir, sortKey]);

  const bulkSearchRequest = useMemo(() => {
    if (!appliedFilters.search.includes("\n")) return null;
    return {
      terms: appliedFilters.search.split(/\r?\n/).map((term) => term.trim()).filter(Boolean),
      status: appliedFilters.statuses.length ? appliedFilters.statuses.join(",") : undefined,
      date_from: appliedFilters.dateFrom || undefined,
      date_to: appliedFilters.dateTo || undefined,
      category: appliedFilters.categories.length ? appliedFilters.categories.join(",") : undefined,
      cities: appliedFilters.cities.length ? appliedFilters.cities.join(",") : undefined,
      interviewers: appliedFilters.interviewers.length ? appliedFilters.interviewers.join(",") : undefined,
      qc_rule: appliedFilters.qcRules.length ? appliedFilters.qcRules.join(",") : undefined,
      queue: appliedFilters.queues.length ? appliedFilters.queues.join(",") : undefined,
      assignment: appliedFilters.assignments.length ? appliedFilters.assignments.join(",") : undefined,
      sort_by: sortKey,
      sort_dir: sortDir,
      page,
      page_size: MAIN_CASES_PAGE_SIZE,
    };
  }, [appliedFilters, page, sortDir, sortKey]);

  useEffect(() => {
    let cancelled = false;
    setCasesLoading(true);
    setCasesError(null);
    setCaseItems([]);
    setSelectedKeys(new Set());

    const request = bulkSearchRequest
      ? apiFetch<MainCaseListResponse>(
          "/api/main-survey/cases/bulk-search",
          { method: "POST", body: JSON.stringify(bulkSearchRequest) },
          token,
          120_000,
        )
      : apiFetch<MainCaseListResponse>(`/api/main-survey/cases?${requestQueryString}`, {}, token, 45_000);

    request
      .then((payload) => {
        if (cancelled) return;
        setCaseItems(payload.items ?? []);
        setTotalCaseCount(Number(payload.total ?? 0));
        setTotalOpenIssueCount(Number(payload.totalOpenIssues ?? 0));
        setFilterOptions({
          cities: payload.filterOptions?.cities ?? [],
          interviewers: payload.filterOptions?.interviewers ?? [],
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setCaseItems([]);
        setTotalCaseCount(0);
        setTotalOpenIssueCount(0);
        setCasesError(error instanceof Error ? error.message : "Unable to load Main Data Explorer cases.");
      })
      .finally(() => {
        if (!cancelled) {
          setCasesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bulkSearchRequest, requestQueryString, token]);

  const filteredCaseItems = useMemo(() => {
    return caseItems;
  }, [caseItems]);

  const items = useMemo(() => {
    return filteredCaseItems;
  }, [filteredCaseItems, page]);
  const casesQuery = { isFetching: casesLoading, isError: Boolean(casesError), error: casesError ? new Error(casesError) : null, isLoading: casesLoading };


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

  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const validKeys = new Set(items.map((item) => item.submission_key));
      const next = new Set(Array.from(prev).filter((key) => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const currentSearchParams = searchParams.toString();

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (appliedFilters.categories.length) nextParams.set("category", appliedFilters.categories.join(","));
    if (appliedFilters.statuses.length) nextParams.set("status", appliedFilters.statuses.join(","));
    if (appliedFilters.cities.length) nextParams.set("cities", appliedFilters.cities.join(","));
    if (appliedFilters.interviewers.length) nextParams.set("interviewers", appliedFilters.interviewers.join(","));
    if (appliedFilters.queues.length) nextParams.set("queue", appliedFilters.queues.join(","));
    if (appliedFilters.assignments.length) nextParams.set("assignment", appliedFilters.assignments.join(","));
    if (appliedFilters.qcRules.length) nextParams.set("qc_rule", appliedFilters.qcRules.join(","));
    if (appliedFilters.search && !appliedFilters.search.includes("\n")) nextParams.set("search", appliedFilters.search);
    if (appliedFilters.dateFrom) nextParams.set("date_from", appliedFilters.dateFrom);
    if (appliedFilters.dateTo) nextParams.set("date_to", appliedFilters.dateTo);
    if (sortKey !== "submitted_at") nextParams.set("sort_by", sortKey);
    if (sortDir !== "desc") nextParams.set("sort_dir", sortDir);
    if (page > 1) nextParams.set("page", String(page));
    const nextValue = nextParams.toString();
    if (currentSearchParams !== nextValue) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [appliedFilters, currentSearchParams, page, setSearchParams, sortDir, sortKey]);

  const summary = useMemo(() => {
    const totals = filteredCaseItems.reduce(
      (acc, item) => {
        acc.pendingChanges += item.pending_change_count;
        return acc;
      },
      { pendingChanges: 0 },
    );
    const pageIssueCount = filteredCaseItems.reduce((count, item) => {
      const qcFlags = Number((item as MainCaseListItem & { qc_flag_count?: number }).qc_flag_count ?? 0);
      return count + Math.max(item.open_issue_count, qcFlags);
    }, 0);
    return { total: totalCaseCount, visible: items.length, issues: totalOpenIssueCount || pageIssueCount, ...totals };
  }, [filteredCaseItems, items.length, totalCaseCount, totalOpenIssueCount]);

  const itemsWithLoad = useMemo(
    () => items.map((item) => {
      const qcFlags = Number((item as MainCaseListItem & { qc_flag_count?: number }).qc_flag_count ?? 0);
      const issueCount = Math.max(item.open_issue_count, qcFlags);
      return {
        ...item,
        qc_load: issueCount,
        region_sort: caseRegionLabel(item),
        status_sort: mainApprovalDisplayLabel(item),
      };
    }),
    [items],
  );
  const sortedItems = itemsWithLoad;
  const handleSort = useCallback((nextKey: string) => {
    setPage(1);
    setSelectedKeys(new Set());
    const nextDir = sortKey === nextKey ? (sortDir === "asc" ? "desc" : "asc") : nextKey === "submitted_at" ? "desc" : "asc";
    setSortKey(nextKey);
    setSortDir(nextDir);
  }, [sortDir, sortKey]);
  const queueSubmissionKeys = useMemo(() => items.map((item) => item.submission_key), [items]);
  const detailQueryString = useMemo(() => {
    const query = new URLSearchParams();
    if (appliedFilters.statuses.length) query.set("status", appliedFilters.statuses.join(","));
    if (appliedFilters.search) query.set("search", appliedFilters.search);
    if (appliedFilters.dateFrom) query.set("date_from", appliedFilters.dateFrom);
    if (appliedFilters.dateTo) query.set("date_to", appliedFilters.dateTo);
    if (appliedFilters.categories.length) query.set("category", appliedFilters.categories.join(","));
    if (appliedFilters.cities.length) query.set("cities", appliedFilters.cities.join(","));
    if (appliedFilters.interviewers.length) query.set("interviewers", appliedFilters.interviewers.join(","));
    if (appliedFilters.queues.length) query.set("queue", appliedFilters.queues.join(","));
    if (appliedFilters.assignments.length) query.set("assignment", appliedFilters.assignments.join(","));
    if (appliedFilters.qcRules.length) query.set("qc_rule", appliedFilters.qcRules.join(","));
    query.set("sort_by", sortKey);
    query.set("sort_dir", sortDir);
    if (page > 1) query.set("page", String(page));
    const value = query.toString();
    return value ? `?${value}` : "";
  }, [appliedFilters, page, sortDir, sortKey]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalCaseCount / MAIN_CASES_PAGE_SIZE));
  }, [totalCaseCount]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);


  const canBulkSelect = Boolean(user);
  const canBulkApprove = canBulkSelect;
  const canBulkDelete = Boolean(user);
  const canBulkAssignQueues = canBulkSelect;
  const canUnassignQueues = canBulkAssignQueues && user?.role !== "PDM-QC";
  const allSelected = items.length > 0 && items.every((i) => selectedKeys.has(i.submission_key));
  const someSelected = selectedKeys.size > 0;
  const selectedItems = useMemo(() => items.filter((item) => selectedKeys.has(item.submission_key)), [items, selectedKeys]);
  const allApprovedSelected = selectedItems.length > 0 && selectedItems.every((item) => item.approval_stage === "approved" || item.approval_stage === "reviewed_approved");
  const anyCallbackSelected = selectedItems.some((item) => item.has_callback_history);
  const anyAudioSelected = selectedItems.some((item) => item.has_audio_history);

  const toggleAll = useCallback(() => {
    startTransition(() => {
      if (allSelected) {
        setSelectedKeys(new Set());
      } else {
        setSelectedKeys(new Set(items.map((i) => i.submission_key)));
      }
    });
  }, [allSelected, items]);

  const toggleOne = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const openPushModal = useCallback((type: PushModalType) => {
    startTransition(() => {
      setSelectedRole("PDM-QC");
      setSelectedUserId("");
      setPushModalType(type);
    });
  }, []);

  const openDeleteModal = useCallback(() => {
    startTransition(() => {
      setDeleteReason("");
      setDeleteConfirmOpen(true);
    });
  }, []);

  const openApproveModal = useCallback(() => {
    startTransition(() => {
      setApproveConfirmOpen(true);
    });
  }, []);


  function applyFilters() {
    setPage(1);
    setAppliedFilters({
      statuses: statusFilters,
      categories: categoryFilters,
      cities: cityFilters,
      interviewers: interviewerFilters,
      queues: queueFilters,
      assignments: assignmentFilters,
      qcRules: appliedFilters.qcRules,
      search: deferredSearch,
      dateFrom,
      dateTo,
    });
  }

  function resetFilters() {
    setStatusFilters([]);
    setCategoryFilters([]);
    setCityFilters([]);
    setInterviewerFilters([]);
    setQueueFilters([]);
    setAssignmentFilters([]);
    setSearch("");
    setBulkSearchDraft("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setAppliedFilters({ statuses: [], categories: [], cities: [], interviewers: [], queues: [], assignments: [], qcRules: [], search: "", dateFrom: "", dateTo: "" });
  }

  function applyBulkSearch() {
    if (!bulkSearchTerms.length) return;
    const bulkSearch = bulkSearchTerms.join("\n");
    setSearch("");
    setPage(1);
    setAppliedFilters((current) => ({ ...current, search: bulkSearch }));
    setBulkSearchDraft(bulkSearch);
    setBulkSearchOpen(false);
    setFilterModalOpen(false);
  }

  async function handleExportTable() {
    let exportPayload: { items: MainCaseListItem[]; total: number };
    if (bulkSearchRequest) {
      exportPayload = await apiFetch<{ items: MainCaseListItem[]; total: number }>(
        "/api/main-survey/cases/bulk-search",
        {
          method: "POST",
          body: JSON.stringify({ ...bulkSearchRequest, page: 1, page_size: 100_000 }),
        },
        token,
        120_000,
      );
    } else {
      const exportQuery = new URLSearchParams();
      if (appliedFilters.statuses.length) exportQuery.set("status", appliedFilters.statuses.join(","));
      if (appliedFilters.search) exportQuery.set("search", appliedFilters.search);
      if (appliedFilters.dateFrom) exportQuery.set("date_from", appliedFilters.dateFrom);
      if (appliedFilters.dateTo) exportQuery.set("date_to", appliedFilters.dateTo);
      if (appliedFilters.categories.length) exportQuery.set("category", appliedFilters.categories.join(","));
      if (appliedFilters.cities.length) exportQuery.set("cities", appliedFilters.cities.join(","));
      if (appliedFilters.interviewers.length) exportQuery.set("interviewers", appliedFilters.interviewers.join(","));
      if (appliedFilters.queues.length) exportQuery.set("queue", appliedFilters.queues.join(","));
      if (appliedFilters.assignments.length) exportQuery.set("assignment", appliedFilters.assignments.join(","));
      if (appliedFilters.qcRules.length) exportQuery.set("qc_rule", appliedFilters.qcRules.join(","));
      exportQuery.set("sort_by", sortKey);
      exportQuery.set("sort_dir", sortDir);
      exportPayload = await apiFetch<{ items: MainCaseListItem[]; total: number }>(
        `/api/main-survey/cases/export?${exportQuery.toString()}`,
        {},
        token,
        60_000,
      );
    }
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "");
    exportRowsToExcel({
      rows: exportPayload.items ?? [],
      columns: [
        { header: "Submission Key", value: (row) => row.submission_key, width: 30 },
        { header: "Start Date/Time", value: (row) => formatDate(row.start_time ?? row.submitted_at), width: 22 },
        { header: "Submission Date/Time", value: (row) => formatDate(row.submitted_at), width: 22 },
        { header: "Region", value: (row) => row.region_label ?? row.state_name ?? "-", width: 18 },
        { header: "Sector", value: (row) => row.sector_label ?? "-", width: 24 },
        { header: "Interviewer", value: (row) => row.interviewer_id ?? "-", width: 18 },
        { header: "Username", value: (row) => row.username ?? "-", width: 18 },
        { header: "Selected Panels", value: (row) => selectedPanelLabel(row), width: 34 },
        { header: "Approval Status", value: (row) => mainApprovalDisplayLabel(row), width: 18 },
        { header: "Auto-flagged QC Issues", value: (row) => Math.max(row.open_issue_count, Number(row.qc_flag_count ?? 0)), width: 22 },
        { header: "Auto-flagged QC Issue Codes", value: (row) => row.auto_flagged_qc_issue_codes ?? "-", width: 38 },
        { header: "Auto-flagged QC Issue Details", value: (row) => row.auto_flagged_qc_issues ?? "-", width: 80 },
        { header: "Open QC Issues", value: (row) => row.open_issue_count ?? 0, width: 16 },
        { header: "Pushed to Recontact", value: (row) => row.has_callback_history ? "Yes" : "No", width: 20 },
        { header: "Recontact Assigned To", value: (row) => row.callback_assigned_to_name ?? "-", width: 24 },
        { header: "Pushed to Silent Listening", value: (row) => row.has_audio_history ? "Yes" : "No", width: 24 },
        { header: "Silent Listening Assigned To", value: (row) => row.audio_assigned_to_name ?? "-", width: 28 },
        { header: "Final Outcome", value: (row) => row.final_outcome_code ? formatToken(row.final_outcome_code) : "-", width: 18 },
        { header: "Approved By", value: (row) => row.approved_by ?? "-", width: 24 },
        { header: "GPS Latitude", value: (row) => row.gps_lat ?? "-", width: 16 },
        { header: "GPS Longitude", value: (row) => row.gps_long ?? "-", width: 16 },
      ],
      filename: `main-survey-data-explorer-${categoryFilters.length ? categoryFilters.join("-") : "all"}-${timestamp}.xlsx`,
      sheetName: "Main Survey Data Explorer",
    });
  }

  async function executeBulkAction(action: BulkAction, role?: string, userId?: string, overrideKeys?: string[], skipAssignedPrompt = false) {
    setBulk({ action, saving: true, result: null });
    try {
      let keys = overrideKeys ?? Array.from(selectedKeys);
      let selectedCount = keys.length;
      if ((action === "callback" || action === "audio") && !skipAssignedPrompt) {
        const selected = items.filter((item) => keys.includes(item.submission_key));
        const isAssigned = (item: MainCaseListItem) => action === "callback" ? item.has_callback_history : item.has_audio_history;
        const unassignedKeys = selected.filter((item) => !isAssigned(item)).map((item) => item.submission_key);
        const assigned = selected.length - unassignedKeys.length;
        if (assigned > 0) {
          setBulk(null);
          setAssignmentConfirm({ action, role: role ?? "PDM-QC", userId: userId ?? "", assigned, unassignedKeys });
          return;
        }
        keys = unassignedKeys;
      }
      selectedCount = keys.length;
      if (keys.length === 0) {
        setBulk({ action, saving: false, result: "No unassigned cases selected for this push." });
        return;
      }
      const assignedUser = userId ? roleUsers.find((entry) => entry.user_id === userId) : undefined;
      const assignedName = assignedUser ? `${assignedUser.full_name || assignedUser.username}`.trim() : null;
      if (action === "approve" || action === "unapprove") {
        await apiFetch(
          "/api/main-survey/cases/bulk-status",
          {
            method: "POST",
            body: JSON.stringify({
              submission_keys: keys,
              status: action === "approve" ? "approved" : "pending_review",
            }),
          },
          token,
          120_000,
        );
        const nextStatus = action === "approve" ? "approved" : "pending_review";
        setCaseItems((current) => current.map((item) => keys.includes(item.submission_key) ? { ...item, approval_stage: nextStatus, approved_by: action === "approve" ? "qc_101" : null } : item));
        setBulk({ action, saving: false, result: action === "approve" ? `${selectedCount} case(s) reviewed and approved.` : `${selectedCount} case(s) returned to pending review.` });
      } else if (action === "unassign_callback") {
        await apiFetch(
          "/api/main-survey/callbacks/bulk-unassign",
          { method: "POST", body: JSON.stringify({ submission_keys: keys }) },
          token,
          60_000,
        );
        setCaseItems((current) => current.map((item) => keys.includes(item.submission_key) ? { ...item, has_callback_history: false, callback_assigned_to_user_id: null, callback_assigned_to_name: null } : item));
        setBulk({ action, saving: false, result: `${selectedCount} case(s) retrieved from Respondent Recontact Section.` });
      } else if (action === "unassign_audio") {
        await apiFetch(
          "/api/main-survey/audio-listening/bulk-unassign",
          { method: "POST", body: JSON.stringify({ submission_keys: keys }) },
          token,
          60_000,
        );
        setCaseItems((current) => current.map((item) => keys.includes(item.submission_key) ? { ...item, has_audio_history: false, audio_assigned_to_user_id: null, audio_assigned_to_name: null } : item));
        setBulk({ action, saving: false, result: `${selectedCount} case(s) retrieved from Silent Listening Section.` });
      } else if (action === "delete") {
        const reason = deleteReason.trim();
        if (!reason) {
          setBulk({ action, saving: false, result: "Error: enter a reason before deleting selected cases." });
          return;
        }
        await apiFetch(
          "/api/main-survey/cases/bulk-delete",
          { method: "POST", body: JSON.stringify({ submission_keys: keys, reason }) },
          token,
          60_000,
        );
        setCaseItems((current) => current.filter((item) => !keys.includes(item.submission_key)));
        setDeleteReason("");
        setBulk({ action, saving: false, result: `${selectedCount} case(s) deleted.` });
      } else if (action === "audio") {
        await apiFetch(
          "/api/main-survey/audio-listening/bulk-assign",
          {
            method: "POST",
            body: JSON.stringify({
              submission_keys: keys,
              assigned_to_role: role ?? "PDM-QC",
              assigned_to_user_id: userId,
            }),
          },
          token,
          60_000,
        );
        setCaseItems((current) => current.map((item) => keys.includes(item.submission_key) ? { ...item, has_audio_history: true, audio_assigned_to_user_id: userId ?? null, audio_assigned_to_name: assignedName } : item));
        setBulk({
          action,
          saving: false,
          result: `${selectedCount} case(s) pushed to Silent Listening Section${role ? ` for ${QC_ROLES.find(r => r.value === role)?.label || role}` : ""}.`,
        });
      } else {
        await apiFetch(
          "/api/main-survey/callbacks/bulk",
          {
            method: "POST",
            body: JSON.stringify({
              submission_keys: keys,
              assigned_to_role: role ?? "PDM-QC",
              assigned_to_user_id: userId,
            }),
          },
          token,
          60_000,
        );
        setCaseItems((current) => current.map((item) => keys.includes(item.submission_key) ? { ...item, has_callback_history: true, callback_assigned_to_user_id: userId ?? null, callback_assigned_to_name: assignedName } : item));
        setBulk({
          action,
          saving: false,
          result: `${selectedCount} case(s) pushed to Respondent Recontact Section${role ? ` for ${QC_ROLES.find(r => r.value === role)?.label || role}` : ""}.`,
        });
      }
      setSelectedKeys(new Set());
      setPushModalType(null);
      setSelectedRole("");
      setSelectedUserId("");
    } catch (e: unknown) {
      setBulk({ action, saving: false, result: `Error: ${e instanceof Error ? e.message : "Bulk action failed."}` });
    }
  }

  return (
    <PlatformPage
      title="Main Data Explorer"
      subtitle={categoryFilters.length ? `${categorySummary} cases` : "All BHT tracker cases"}
      syncLabel=""
      module="main"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setFilterModalOpen(true)} className="inline-flex w-fit items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.25)] hover:bg-sky-700">
            <Filter className="h-4 w-4" />
            Control filters
          </button>
          {activeFilterChips.map((chip) => (
            <span
              key={chip.key}
              className={`inline-flex max-w-[min(30rem,100%)] items-center gap-2 truncate rounded-2xl border px-4 py-2 text-xs font-bold ${
                chip.tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white/80 text-slate-700"
              }`}
              title={chip.label}
            >
              <span className="truncate">{chip.label}</span>
              {chip.key === "qcRules" ? (
                <button
                  type="button"
                  onClick={() => {
                    setPage(1);
                    setAppliedFilters((current) => ({ ...current, qcRules: [] }));
                  }}
                  className="rounded-full p-0.5 hover:bg-rose-100"
                  aria-label="Clear QC flag filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
          <DialogContent className="max-h-[86vh] w-[min(calc(100vw-2rem),72rem)] max-w-none overflow-y-auto rounded-3xl border-white/70 bg-white/95 p-0">
            <DialogHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
              <DialogTitle>Main Data Explorer filters</DialogTitle>
            </DialogHeader>
        <Card className="rounded-2xl border border-blue-100/80 bg-white/85 shadow-[0_12px_34px_rgba(37,99,235,0.08)] dark:border-sky-200/60 dark:bg-white/76">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                <Filter className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">Control filters</p>
                <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">Main Survey Review Queue</h3>
              </div>
            </div>

            <div className="grid min-w-0 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Search</label>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkSearchDraft(appliedFilters.search.includes("\n") ? appliedFilters.search : "");
                      setBulkSearchOpen(true);
                    }}
                    className="text-xs font-semibold text-blue-600 underline-offset-4 hover:text-blue-700 hover:underline"
                  >
                    Bulk Search
                  </button>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input placeholder="Search KEY, Region_Resp., panel, status, interviewer, assignee or any case-card info" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11" />
                </div>
              </div>

              <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Category</label>
                <MultiSelectDropdown
                  label="categories"
                  options={BHT_CATEGORY_FILTER_OPTIONS.filter((category) => category.slug !== "all").map((category) => ({ value: category.slug, label: category.label }))}
                  selected={categoryFilters}
                  onChange={(value) => {
                    setCategoryFilters(value);
                    setPage(1);
                    setSelectedKeys(new Set());
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Status</label>
                <MultiSelectDropdown
                  label="statuses"
                  options={MAIN_CASE_STATUS_OPTIONS}
                  selected={statusFilters}
                  onChange={setStatusFilters}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">City</label>
                <MultiSelectDropdown
                  label="cities"
                  options={filterOptions.cities.map((city) => ({ value: city, label: city }))}
                  selected={cityFilters}
                  onChange={(value) => {
                    setCityFilters(value);
                    setPage(1);
                    setSelectedKeys(new Set());
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Interviewer</label>
                <MultiSelectDropdown
                  label="interviewers"
                  options={filterOptions.interviewers.map((interviewer) => ({ value: interviewer, label: interviewer }))}
                  selected={interviewerFilters}
                  onChange={(value) => {
                    setInterviewerFilters(value);
                    setPage(1);
                    setSelectedKeys(new Set());
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Queue</label>
                <MultiSelectDropdown
                  label="queues"
                  options={MAIN_CASE_QUEUE_OPTIONS}
                  selected={queueFilters}
                  onChange={(value) => {
                    setQueueFilters(value);
                    setPage(1);
                    setSelectedKeys(new Set());
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Assignment</label>
                <MultiSelectDropdown
                  label="assignment"
                  options={MAIN_CASE_ASSIGNMENT_OPTIONS}
                  selected={assignmentFilters}
                  onChange={(value) => {
                    setAssignmentFilters(value);
                    setPage(1);
                    setSelectedKeys(new Set());
                  }}
                />
              </div>

              </div>
            </div>

            {/* Date range filter */}
            <div className="mt-4 grid gap-4 md:grid-cols-[220px_220px_auto] md:items-end">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Date from</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-[1rem] border border-white/70 bg-white/44 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Date to</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-[1rem] border border-white/70 bg-white/44 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {(dateFrom || dateTo) && (
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    className="mb-0.5 rounded-[1rem] border border-white/70 bg-white/44 px-3 py-2 text-xs text-slate-500 hover:bg-white/60"
                  >
                    Clear dates
                  </button>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { applyFilters(); setFilterModalOpen(false); }} className="h-11 rounded-xl border-blue-100 text-blue-700">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Apply
              </Button>
              <Button variant="ghost" onClick={resetFilters} className="h-11 rounded-xl text-slate-600">Reset</Button>
            </div>
          </CardContent>
        </Card>
          </DialogContent>
        </Dialog>

        <Dialog open={bulkSearchOpen} onOpenChange={setBulkSearchOpen}>
          <DialogContent className="w-[min(calc(100vw-2rem),36rem)] max-w-none rounded-3xl border-white/70 bg-white/95 p-0 shadow-2xl">
            <DialogHeader className="border-b border-slate-100 px-6 pb-4 pt-6">
              <DialogTitle>Bulk Search</DialogTitle>
              <DialogDescription>
                Paste one search value per line. Cases matching any line will be returned.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-6 pb-6">
              <Textarea
                autoFocus
                value={bulkSearchDraft}
                onChange={(event) => setBulkSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") applyBulkSearch();
                }}
                placeholder={"Enter one value per line\nExample:\nKEY-001\nInterviewer name\nLagos"}
                className="min-h-64 resize-y rounded-2xl border-slate-200 bg-white font-mono text-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {bulkSearchTerms.length
                    ? `${bulkSearchTerms.length} unique search ${bulkSearchTerms.length === 1 ? "term" : "terms"}`
                    : "No search terms entered"}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setBulkSearchOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={applyBulkSearch} disabled={!bulkSearchTerms.length} className="bg-blue-600 text-white hover:bg-blue-700">
                    <Search className="mr-2 h-4 w-4" />
                    Search
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(assignmentConfirm)} onOpenChange={(open) => !open && setAssignmentConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Some selected cases are already assigned</DialogTitle>
              <DialogDescription>
                {assignmentConfirm ? `${assignmentConfirm.assigned} selected case(s) are already pushed to this queue. ${assignmentConfirm.unassignedKeys.length} case(s) are unassigned.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAssignmentConfirm(null)}>Cancel</Button>
              <Button
                disabled={!assignmentConfirm?.unassignedKeys.length}
                onClick={() => {
                  const pending = assignmentConfirm;
                  if (!pending) return;
                  setAssignmentConfirm(null);
                  void executeBulkAction(pending.action, pending.role, pending.userId, pending.unassignedKeys, true);
                }}
              >
                Assign unassigned cases
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Card className="glass-panel rounded-[1.8rem] border-white/70">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/60 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Submission queue</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">{categorySummary} Data Explorer</h3>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={handleExportTable} className="h-9 rounded-2xl" disabled={sortedItems.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                  {summaryValue(summary.total)} total cases
                </div>
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                  Page {page} of {summaryValue(totalPages)} · {summaryValue(summary.visible)} rows shown
                </div>
                {casesQuery.isFetching ? (
                  <div className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700">Refreshing…</div>
                ) : null}
                {summary.issues > 0 ? (
                  <div className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700">
                    {summaryValue(summary.issues)} open issues
                  </div>
                ) : null}
              </div>
            </div>

            {casesQuery.isError ? (
              <div className="border-b border-rose-200/70 bg-rose-50/60 px-6 py-3 text-sm text-rose-700">
                {casesQuery.error instanceof Error ? casesQuery.error.message : "Failed to load the review queue."}
              </div>
            ) : null}

            {canBulkSelect && someSelected ? (
              <div className="flex items-center gap-3 border-b border-white/40 bg-sky-50/40 px-6 py-3">
                <span className="text-sm font-semibold text-sky-800">{selectedKeys.size} selected</span>
                <div className="flex flex-1 items-center gap-2">
                  {canBulkApprove ? (
                    <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
                      <button
                        type="button"
                        disabled={bulk?.saving}
                        onClick={openApproveModal}
                        className="flex items-center gap-1.5 rounded-[1rem] border border-emerald-400/40 bg-emerald-50/60 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100/70 disabled:opacity-50"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        {allApprovedSelected ? "Unapprove Selected" : "Approve Selected"}
                      </button>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Confirm status update</DialogTitle>
                          <DialogDescription>
                            {allApprovedSelected
                              ? `You are about to unapprove ${selectedKeys.size} selected Main Survey case(s). They will be moved back to Pending Review.`
                              : `You are about to approve ${selectedKeys.size} selected Main Survey case(s).`}
                          </DialogDescription>
                        </DialogHeader>
                        <div className="flex justify-end gap-2 pt-2">
                          <Button variant="outline" onClick={() => setApproveConfirmOpen(false)}>Cancel</Button>
                          <Button
                            onClick={() => {
                              setApproveConfirmOpen(false);
                              void executeBulkAction(allApprovedSelected ? "unapprove" : "approve");
                            }}
                          >
                            Confirm
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  ) : null}

                  {canBulkAssignQueues ? (
                    <Dialog open={pushModalType === "callback"} onOpenChange={(open) => !open && setPushModalType(null)}>
                    <button
                        type="button"
                        disabled={bulk?.saving}
                        onClick={() => openPushModal("callback")}
                        className="flex items-center gap-1.5 rounded-[1rem] border border-amber-400/40 bg-amber-50/60 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100/70 disabled:opacity-50"
                      >
                        <PhoneCall className="h-3.5 w-3.5" />
                        Push to Respondent Recontact
                      </button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Push to Respondent Recontact Section</DialogTitle>
                        <DialogDescription>Select the PDM-QC user who should receive this recontact assignment.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Assign to Role</label>
                          <select className={SELECT_CLASS} value={selectedRole || "PDM-QC"} disabled>
                            {QC_ROLES.map((role) => (
                              <option key={role.value} value={role.value}>{role.label}</option>
                            ))}
                          </select>
                        </div>
                        {(selectedRole || "PDM-QC") ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Select User</label>
                            <select className={SELECT_CLASS} value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} disabled={loadingUsers}>
                              <option value="">Select a PDM-QC user</option>
                              {roleUsers.map((u) => (
                                <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.username})</option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => { setPushModalType(null); setSelectedRole(""); setSelectedUserId(""); }}>Cancel</Button>
                          <Button disabled={!selectedUserId || loadingUsers || Boolean(bulk?.saving)} onClick={() => void executeBulkAction("callback", "PDM-QC", selectedUserId)}>
                            Push {selectedKeys.size} Case(s)
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                    </Dialog>
                  ) : null}

                  {canUnassignQueues && anyCallbackSelected ? (
                    <button
                      type="button"
                      disabled={bulk?.saving}
                      onClick={() => void executeBulkAction("unassign_callback")}
                      className="flex items-center gap-1.5 rounded-[1rem] border border-amber-400/40 bg-white/70 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50/80 disabled:opacity-50"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      Retrieve Recontact
                    </button>
                  ) : null}

                  {canUnassignQueues && anyAudioSelected ? (
                    <button
                      type="button"
                      disabled={bulk?.saving}
                      onClick={() => void executeBulkAction("unassign_audio")}
                      className="flex items-center gap-1.5 rounded-[1rem] border border-violet-400/40 bg-white/70 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-50/80 disabled:opacity-50"
                    >
                      <Headphones className="h-3.5 w-3.5" />
                      Retrieve Silent Listening
                    </button>
                  ) : null}

                  {canBulkAssignQueues ? (
                    <Dialog open={pushModalType === "audio"} onOpenChange={(open) => !open && setPushModalType(null)}>
                    <button
                        type="button"
                        disabled={bulk?.saving}
                        onClick={() => openPushModal("audio")}
                        className="flex items-center gap-1.5 rounded-[1rem] border border-violet-400/40 bg-violet-50/60 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100/70 disabled:opacity-50"
                      >
                        <Headphones className="h-3.5 w-3.5" />
                        Push to Silent Listening
                      </button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Push to Silent Listening Section</DialogTitle>
                        <DialogDescription>Select the PDM-QC user who should receive this silent listening assignment.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Assign to Role</label>
                          <select className={SELECT_CLASS} value={selectedRole || "PDM-QC"} disabled>
                            {QC_ROLES.map((role) => (
                              <option key={role.value} value={role.value}>{role.label}</option>
                            ))}
                          </select>
                        </div>
                        {(selectedRole || "PDM-QC") ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Select User</label>
                            <select className={SELECT_CLASS} value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} disabled={loadingUsers}>
                              <option value="">Select a PDM-QC user</option>
                              {roleUsers.map((u) => (
                                <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.username})</option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => { setPushModalType(null); setSelectedRole(""); setSelectedUserId(""); }}>Cancel</Button>
                          <Button disabled={!selectedUserId || loadingUsers || Boolean(bulk?.saving)} onClick={() => void executeBulkAction("audio", "PDM-QC", selectedUserId)}>
                            Push {selectedKeys.size} Case(s)
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                    </Dialog>
                  ) : null}

                  {canBulkDelete ? (
                    <Dialog open={deleteConfirmOpen} onOpenChange={(open) => { setDeleteConfirmOpen(open); if (!open) setDeleteReason(""); }}>
                    <button
                        type="button"
                        disabled={bulk?.saving}
                        onClick={openDeleteModal}
                        className="flex items-center gap-1.5 rounded-[1rem] border border-rose-400/40 bg-rose-50/60 px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100/70 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        Delete Selected
                      </button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Confirm case deletion</DialogTitle>
                        <DialogDescription>
                          You are about to delete {selectedKeys.size} Main Survey Data Explorer case(s). This action cannot be undone.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2 py-2">
                        <label className="text-sm font-semibold text-slate-700" htmlFor="main-delete-reason">
                          Reason for Deleting Case(s)
                        </label>
                        <Textarea
                          id="main-delete-reason"
                          value={deleteReason}
                          onChange={(event) => setDeleteReason(event.target.value)}
                          rows={4}
                          placeholder="Enter the reason these selected case(s) should be deleted..."
                          className="resize-none rounded-2xl border-slate-200 bg-white text-sm text-slate-900"
                        />
                        <p className="text-xs text-slate-500">A reason is required and will be saved with the deleted case record.</p>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => { setDeleteConfirmOpen(false); setDeleteReason(""); }}>Cancel</Button>
                        <Button
                          variant="destructive"
                          disabled={!deleteReason.trim() || Boolean(bulk?.saving)}
                          onClick={() => {
                            setDeleteConfirmOpen(false);
                            void executeBulkAction("delete");
                          }}
                        >
                          Confirm Delete
                        </Button>
                      </div>
                    </DialogContent>
                    </Dialog>
                  ) : null}
                </div>
                {bulk?.result ? (
                  <span className={cn("rounded-full px-3 py-1 text-xs font-medium", bulk.result.startsWith("Error") ? "bg-rose-100/70 text-rose-700" : "bg-emerald-100/70 text-emerald-700")}>
                    {bulk.result}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => { setSelectedKeys(new Set()); setBulk(null); setPushModalType(null); setDeleteConfirmOpen(false); setDeleteReason(""); setApproveConfirmOpen(false); setSelectedRole(""); setSelectedUserId(""); }}
                  className="ml-auto flex items-center gap-1 rounded-[1rem] border border-white/60 bg-white/40 px-3 py-1.5 text-xs text-slate-600 hover:bg-white/60"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              </div>
            ) : null}

            <div className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { key: "region_sort", label: "Region" },
                  { key: "status_sort", label: "Status" },
                  { key: "qc_load", label: "Auto-flagged QC Issues" },
                ].map((sort) => (
                  <button
                    key={sort.key}
                    type="button"
                    onClick={() => handleSort(sort.key as keyof (MainCaseListItem & { qc_load: number; region_sort: string; status_sort: string }))}
                    className="rounded-full border border-white/70 bg-white/45 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white/70"
                  >
                    Sort: {sort.label} {sortKey === sort.key ? (sortDir === "asc" ? "up" : "down") : ""}
                  </button>
                ))}
                {canBulkSelect ? (
                  <button type="button" onClick={toggleAll} className="ml-auto rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100">
                    {allSelected ? "Clear page selection" : "Select all visible"}
                  </button>
                ) : null}
                <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/45 px-2 py-1 text-xs font-semibold text-slate-600">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full px-2 py-1 hover:bg-white/70 disabled:opacity-40">Prev</button>
                  <span>Page {page} / {totalPages}</span>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-full px-2 py-1 hover:bg-white/70 disabled:opacity-40">Next</button>
                </div>
              </div>
            <div className="max-h-[72vh] overflow-y-auto pr-2">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {sortedItems.map((item) => {
                const qcFlags = Number((item as MainCaseListItem & { qc_flag_count?: number }).qc_flag_count ?? 0);
                const issueCount = Math.max(item.open_issue_count, qcFlags);
                const loadTone = issueCount >= 5 ? "text-rose-700" : issueCount >= 2 ? "text-amber-700" : "text-emerald-700";
                const regionLabel = caseRegionLabel(item);
                const regionCaseTitle = regionLabel === "Region"
                  ? `Resp._${item.region_respondent_ordinal ?? 1}`
                  : `${regionLabel}_Resp._${item.region_respondent_ordinal ?? 1}`;
                return (
                  <article key={item.submission_key} className={cn("rounded-2xl border border-white/70 bg-white/62 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]", canBulkSelect && selectedKeys.has(item.submission_key) && "border-sky-300 bg-sky-50/70")}>
                    <div className="flex items-start gap-3">
                      {canBulkSelect ? <button type="button" onClick={() => toggleOne(item.submission_key)} className="mt-1 text-slate-400 hover:text-slate-700">{selectedKeys.has(item.submission_key) ? <CheckSquare className="h-4 w-4 text-sky-600" /> : <Square className="h-4 w-4" />}</button> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">{truncateValue(item.case_id ?? item.submission_key, 22)}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-semibold text-slate-950">{regionCaseTitle}</h4>
                              {item.has_callback_history ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700" title="Pushed to Respondent Recontact Section">
                                  <PhoneCall className="h-3 w-3" />
                                  Recontact
                                </span>
                              ) : null}
                              {item.has_audio_history ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-violet-300/60 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700" title="Pushed to Silent Listening Section">
                                  <Headphones className="h-3 w-3" />
                                  Audio
                                </span>
                              ) : null}
                            </div>
                            {item.ea_name || item.ea_id ? <p className="mt-0.5 text-xs text-slate-500">{item.ea_name ?? item.ea_id}</p> : null}
                            <p className="mt-1 text-xs font-medium text-slate-600"><span className="font-bold text-slate-700">Selected Panels:</span> {selectedPanelLabel(item)}</p>
                            <p className={`mt-1 text-xs font-bold ${loadTone}`}>Auto-flagged QC Issues: {issueCount}</p>
                          </div>
                          <Badge variant="outline" className={`border text-[11px] font-semibold ${statusBadgeClass(item.approval_stage)}`}>{mainApprovalDisplayLabel(item)}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-slate-200/70 pt-2.5">
                          <div className="space-y-1 text-xs text-slate-500">
                            <div><span className="font-semibold uppercase tracking-[0.08em] text-slate-700">Start Date/Time:</span> {formatDate(item.start_time ?? item.submitted_at)}</div>
                            <div><span className="font-semibold text-slate-700">Assigned to:</span> {assignmentLabel(item)}</div>
                          </div>
                          <Link to={{ pathname: `/main/cases/${encodeURIComponent(item.submission_key)}`, search: detailQueryString }} state={{ queueSubmissionKeys }} className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">Open case</Link>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {sortedItems.length === 0 ? <div className="col-span-full py-12 text-center text-sm text-slate-500">{casesLoading ? "Refreshing Data................" : "No cases match the current filters."}</div> : null}
            </div>
            </div>
            </div>

            <ScrollableTable className="hidden" maxHeight={850}>
              <ScrollableTableHeader>
                <TableRow className="border-white/60 hover:bg-transparent">
                  {canBulkSelect ? (
                    <TableHead className="w-10 pl-4">
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="flex items-center text-slate-400 hover:text-slate-700"
                        title={allSelected ? "Deselect all" : "Select all"}
                      >
                        {allSelected ? <CheckSquare className="h-4 w-4 text-sky-600" /> : <Square className="h-4 w-4" />}
                      </button>
                    </TableHead>
                  ) : null}
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("submission_key")}>Case ID {sortKey === "submission_key" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("ea_name")}>Ward and location {sortKey === "ea_name" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("state_name")}>State {sortKey === "state_name" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("approved_by")}>Approval By {sortKey === "approved_by" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("approval_stage")}>Status {sortKey === "approval_stage" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("section_count")}>Sections {sortKey === "section_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("qc_load")}>QC load {sortKey === "qc_load" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("supacc_confirm")}>Accompaniment {sortKey === "supacc_confirm" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("slot_type")}>Slot Type {sortKey === "slot_type" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("username")}>Username {sortKey === "username" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("final_outcome_code")}>Final Outcome {sortKey === "final_outcome_code" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("submitted_at")}>Submitted {sortKey === "submitted_at" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                </TableRow>
              </ScrollableTableHeader>
              <TableBody>
                {sortedItems.map((item) => (
                  <MainCaseRow
                    key={item.submission_key}
                    item={item}
                    canBulkSelect={canBulkSelect}
                    isSelected={selectedKeys.has(item.submission_key)}
                    onToggle={toggleOne}
                    detailQueryString={detailQueryString}
                    queueSubmissionKeys={queueSubmissionKeys}
                  />
                ))}
                {casesQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={canBulkSelect ? 13 : 12} className="py-12 text-center text-sm text-slate-500">
                      Loading review queue…
                    </TableCell>
                  </TableRow>
                ) : null}
                {!casesQuery.isLoading && sortedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canBulkSelect ? 13 : 12} className="py-12 text-center text-sm text-slate-500">
                      {casesLoading ? "Refreshing Data................" : "No cases match the current filters."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </ScrollableTable>
            <div className="flex items-center justify-between gap-3 border-t border-white/60 px-6 py-4">
              <p className="text-sm text-slate-600">
                Showing {(page - 1) * MAIN_CASES_PAGE_SIZE + (summary.visible > 0 ? 1 : 0)}-
                {(page - 1) * MAIN_CASES_PAGE_SIZE + summary.visible} of {summaryValue(summary.total)} cases
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-9 rounded-2xl"
                  disabled={page <= 1 || casesQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-2xl"
                  disabled={page >= totalPages || casesQuery.isFetching}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Next
                </Button>
              </div>
            </div>

          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
}
