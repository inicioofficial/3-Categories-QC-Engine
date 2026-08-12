import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronRight, Download, Eye, EyeOff, ImageIcon, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { PlatformPage } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { ListingQualityTabs } from "@/components/listing/ListingQualityTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { createSurveyCtoSession, hasValidSurveyCtoSession } from "@/lib/surveyctoSession";
import { cn } from "@/lib/utils";

interface PictureCheckItem {
  submission_key: string;
  ea_id: string | null;
  ea_name: string | null;
  state_name: string | null;
  building_only_count: number;
  household_count: number;
  total_rows: number;
  building_only_pct: number;
  residential_pct: number;
  remittance_pct: number;
  sampled_from_remittance: number;
  check_id: string | null;
  check_status: string | null;
  assigned_to_user_id: string | null;
  assigned_to_username: string | null;
  accompanied_value?: string | null;
  photo_count?: number;
  submitted_at?: string | null;
  surveycto_submission_key?: string | null;
  interviewer_id?: string | null;
  total_interviews?: number;
  accompanied_interviews?: number;
  accompanied_pct?: number;
}

interface QcUser {
  user_id: string;
  username: string;
  full_name: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/12 text-amber-700",
  checked: "border-sky-500/30 bg-sky-500/12 text-sky-700",
  approved: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700",
  rejected: "border-rose-500/30 bg-rose-500/12 text-rose-700",
};

const SYNTHETIC_PHOTO_ITEMS: PictureCheckItem[] = [
  { submission_key: "PHOTO-ABJ-001", ea_id: "ABJ-EA-014", ea_name: "Garki Central", state_name: "Abuja", building_only_count: 58, household_count: 84, total_rows: 142, building_only_pct: 40.8, residential_pct: 59.2, remittance_pct: 12.7, sampled_from_remittance: 8, check_id: "pc-001", check_status: "pending", assigned_to_user_id: "qc_101", assigned_to_username: "qc_101" },
  { submission_key: "PHOTO-KAN-002", ea_id: "KAN-EA-011", ea_name: "Tarauni Ward", state_name: "Kano", building_only_count: 63, household_count: 56, total_rows: 119, building_only_pct: 52.9, residential_pct: 47.1, remittance_pct: 9.2, sampled_from_remittance: 8, check_id: "pc-002", check_status: "rejected", assigned_to_user_id: "qc_102", assigned_to_username: "qc_102" },
  { submission_key: "PHOTO-PHC-003", ea_id: "PHC-EA-031", ea_name: "Rumuola Axis", state_name: "PHC", building_only_count: 57, household_count: 76, total_rows: 133, building_only_pct: 42.9, residential_pct: 57.1, remittance_pct: 13.5, sampled_from_remittance: 8, check_id: "pc-003", check_status: "approved", assigned_to_user_id: "qc_103", assigned_to_username: "qc_103" },
  { submission_key: "PHOTO-IBD-004", ea_id: "IBD-EA-018", ea_name: "Bodija Market", state_name: "Ibadan", building_only_count: 71, household_count: 85, total_rows: 156, building_only_pct: 45.5, residential_pct: 54.5, remittance_pct: 10.3, sampled_from_remittance: 8, check_id: "pc-004", check_status: "pending", assigned_to_user_id: "qc_104", assigned_to_username: "qc_104" },
];

type ListingPictureCheckPageProps = {
  module?: "listing" | "main";
};

type SortKey =
  | "state_name"
  | "interviewer_id"
  | "total_interviews"
  | "accompanied_interviews"
  | "accompanied_pct"
  | "check_status"
  | "assigned_to_username"
  | "ea_name"
  | "ea_id"
  | "building_only_pct"
  | "residential_pct"
  | "remittance_pct"
  | "sampled_from_remittance";

type SortDirection = "asc" | "desc";

function sortValue(row: PictureCheckItem, key: SortKey): string | number {
  switch (key) {
    case "interviewer_id":
      return (row.interviewer_id ?? row.ea_name ?? "").toLowerCase();
    case "state_name":
    case "check_status":
    case "assigned_to_username":
    case "ea_name":
    case "ea_id":
      return String(row[key] ?? "").toLowerCase();
    default:
      return Number(row[key] ?? 0);
  }
}

export function ListingPictureCheckPage({ module = "listing" }: ListingPictureCheckPageProps) {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = Boolean(user);
  const isMainModule = module === "main";

  const [items, setItems] = useState<PictureCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qcUsers, setQcUsers] = useState<QcUser[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [surveyUsername, setSurveyUsername] = useState("");
  const [surveyPassword, setSurveyPassword] = useState("");
  const [showSurveyPassword, setShowSurveyPassword] = useState(false);
  const [surveyLoggingIn, setSurveyLoggingIn] = useState(false);
  const [exportingEvidence, setExportingEvidence] = useState(false);
  const [surveyLoginError, setSurveyLoginError] = useState<string | null>(null);
  const [selectedSubmissionKey, setSelectedSubmissionKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("state_name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Admin history/filter controls
  const [showHistory, setShowHistory] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  async function loadItems() {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (isAdmin && showHistory) {
        params.set("show_history", "true");
        if (filterStatus) params.set("filter_status", filterStatus);
        if (filterDateFrom) params.set("filter_date_from", filterDateFrom);
        if (filterDateTo) params.set("filter_date_to", filterDateTo);
      }
      const qs = params.toString() ? `?${params.toString()}` : "";
      const endpoint = isMainModule ? `/api/main-survey/accompaniment${qs}` : `/api/listing/picture-check${qs}`;
      const payload = await apiFetch<{ items: PictureCheckItem[] }>(endpoint, {}, token);
      setItems(payload.items ?? []);
    } catch (err) {
      if (isMainModule) {
        setLoadError(err instanceof Error ? err.message : "Failed to load accompaniment records.");
      } else {
        setItems(SYNTHETIC_PHOTO_ITEMS);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadQcUsers() {
    try {
      const payload = await apiFetch<{ users: QcUser[] }>("/api/admin/users/by-role/PDM-QC", {}, token);
      const users = payload.users ?? [];
      setQcUsers(users);
      setSelectedUserId(users[0]?.user_id ?? "");
    } catch {
      // non-critical
    }
  }

  useEffect(() => {
    void loadItems();
    if (isAdmin) void loadQcUsers();
  }, [token, isMainModule]);

  // Re-fetch when history filters change
  useEffect(() => {
    if (isAdmin && token) void loadItems();
  }, [showHistory, filterStatus, filterDateFrom, filterDateTo]);

  const regionOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.state_name).filter((value): value is string => Boolean(value))))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [items],
  );

  const visibleItems = useMemo(() => {
    const regionSet = new Set(selectedRegions);
    const filtered =
      selectedRegions.length === 0 ? items : items.filter((item) => item.state_name && regionSet.has(item.state_name));
    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? result : -result;
    });
  }, [items, selectedRegions, sortDirection, sortKey]);

  function setSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  function sortableHead(label: string, key: SortKey, align: "left" | "center" | "right" = "left", className = "") {
    const active = sortKey === key;
    const justifyClass = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
    const textClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
    return (
      <TableHead className={cn("bg-white text-[11px] font-bold tracking-[0.1em] text-slate-800", textClass, className)}>
        <button
          type="button"
          onClick={() => setSort(key)}
          className={cn("inline-flex w-full items-center gap-1 text-inherit hover:text-sky-700", justifyClass)}
        >
          <span>{label}</span>
          <span className={cn("text-[10px]", active ? "text-sky-600" : "text-slate-400")}>
            {active ? (sortDirection === "asc" ? "^" : "v") : "^"}
          </span>
        </button>
      </TableHead>
    );
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === visibleItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleItems.map((i) => i.submission_key)));
    }
  }

  async function handleAssign() {
    if (!selectedUserId || selected.size === 0) return;
    setAssigning(true);
    setAssignMessage(null);
    try {
      const endpoint = isMainModule ? "/api/main-survey/accompaniment/assign" : "/api/listing/picture-check/assign";
      const result = await apiFetch<{ created?: number; updated?: number; skipped?: number }>(
        endpoint,
        {
          method: "POST",
          body: JSON.stringify({ submissionKeys: Array.from(selected), assignedToUserId: selectedUserId }),
        },
        token,
      );
      setAssignMessage(`Assigned ${(result.created ?? 0) + (result.updated ?? 0)} case(s).${result.skipped ? ` Skipped ${result.skipped}.` : ""}`);
      setSelected(new Set());
      setAssignModalOpen(false);
      await loadItems();
    } catch (err) {
      setAssignMessage(err instanceof Error ? err.message : "Assignment failed.");
    } finally {
      setAssigning(false);
    }
  }

  async function downloadFlaggedEaCsv() {
    const escapeCsv = (value: unknown) => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const downloadCsv = (headers: string[], rows: unknown[][], filename: string) => {
      const csv = [headers, ...rows].map((line) => line.map(escapeCsv).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    if (isMainModule) {
      setExportingEvidence(true);
      try {
        const detailRows: unknown[][] = [];
        for (const row of visibleItems) {
          const detail = await apiFetch<{
            check?: { state_name?: string | null; ea_name?: string | null; assigned_to_user_id?: string | null; status?: string | null };
            photos?: Array<{
              submission_key?: string | null;
              case_label?: string | null;
              start_time?: string | null;
              submitted_at?: string | null;
              accompanied_value?: string | null;
              photo_ref?: string | null;
              file_name?: string | null;
              variable_name?: string | null;
            }>;
          }>(`/api/main-survey/accompaniment/${encodeURIComponent(row.submission_key)}/detail`, {}, token, 45000);
          const photos = detail.photos ?? [];
          if (!photos.length) {
            detailRows.push([
              row.state_name ?? "",
              row.interviewer_id ?? row.ea_name ?? "",
              "",
              "",
              "",
              "",
              "",
              "",
              row.assigned_to_username ?? "",
              row.check_status ?? "pending",
            ]);
            continue;
          }
          photos.forEach((photo, index) => {
            detailRows.push([
              row.state_name ?? detail.check?.state_name ?? "",
              row.interviewer_id ?? detail.check?.ea_name ?? "",
              photo.submission_key ?? "",
              photo.case_label ?? "",
              photo.start_time ?? photo.submitted_at ?? "",
              photo.accompanied_value ?? "",
              `Photo evidence ${index + 1}`,
              photo.photo_ref ?? photo.file_name ?? "",
              row.assigned_to_username ?? "",
              row.check_status ?? detail.check?.status ?? "pending",
            ]);
          });
        }
        downloadCsv(
          ["State", "Interviewer", "KEY", "Region_Resp", "Start Date/Time", "Accompanied", "Evidence Label", "Photo Evidence Ref", "Assigned To", "Status"],
          detailRows,
          "main-accompaniment-photo-evidence.csv",
        );
      } finally {
        setExportingEvidence(false);
      }
      return;
    }

    const headers = isMainModule
      ? ["State", "Interviewer", "Total Interviews", "Accompanied Interviews", "% Accompanied Interviews", "Status", "Assigned To"]
      : [
          "State",
          "Ward Name",
          "Ward ID",
          "% Non-Residential",
          "% Residential",
          "% Remittance",
          "Sampled from Remittance",
          "Status",
          "Assigned To",
        ];
    const rows = visibleItems.map((row) =>
      isMainModule
        ? [
            row.state_name ?? "",
            row.interviewer_id ?? row.ea_name ?? "",
            row.total_interviews ?? 0,
            row.accompanied_interviews ?? 0,
            row.accompanied_pct ?? 0,
            row.check_status ?? "pending",
            row.assigned_to_username ?? "",
          ]
        : [
            row.state_name ?? "",
            row.ea_name ?? "",
            row.ea_id ?? "",
            row.building_only_pct.toFixed(1),
            row.residential_pct.toFixed(1),
            row.remittance_pct.toFixed(1),
            row.sampled_from_remittance,
            row.check_status ?? "pending",
            row.assigned_to_username ?? "",
          ],
    );
    downloadCsv(headers, rows, "listing-picture-check-flagged-wards.csv");
  }

  function openDetail(submissionKey: string) {
    const detailBasePath = module === "main" ? "/main/accompaniment" : "/listing/picture-check";
    if (!hasValidSurveyCtoSession()) {
      setSelectedSubmissionKey(submissionKey);
      setSurveyModalOpen(true);
      return;
    }
    if (isMainModule) {
      navigate(`${detailBasePath}/${encodeURIComponent(submissionKey)}/detail`, {
        state: { queueKeys: visibleItems.map((item) => item.submission_key) },
      });
      return;
    }
    navigate(`${detailBasePath}/${encodeURIComponent(submissionKey)}/photos`);
  }

  async function submitSurveyLogin() {
    setSurveyLoggingIn(true);
    setSurveyLoginError(null);
    try {
      await createSurveyCtoSession(token, surveyUsername, surveyPassword);
      setSurveyLoggingIn(false);
      setSurveyModalOpen(false);
      setSurveyPassword("");
      const detailBasePath = module === "main" ? "/main/accompaniment" : "/listing/picture-check";
      navigate(`${detailBasePath}/${encodeURIComponent(selectedSubmissionKey ?? "case")}/${isMainModule ? "detail" : "photos"}`, {
        state: isMainModule ? { queueKeys: visibleItems.map((item) => item.submission_key) } : undefined,
      });
    } catch (error) {
      setSurveyLoggingIn(false);
      setSurveyLoginError(error instanceof Error ? error.message : "SurveyCTO login failed.");
    }
  }

  return (
    <PlatformPage
      title={isMainModule ? "Accompaniment" : "Incidence & HH Photo"}
      subtitle={isMainModule ? "Review QC/Supervisor accompaniment answers and uploaded photo evidence" : "Review building photos for Wards with high non-residential ratios"}
      syncLabel={`${visibleItems.length} ${isMainModule ? "record" : "flagged Ward"}${visibleItems.length !== 1 ? "s" : ""}`}
      module={module}
      plainTopBar
    >
      <div className="space-y-5">
        <ListingQualityTabs />

        {assignMessage && (
          <div className="rounded-[1.4rem] border border-white/70 bg-white/44 px-4 py-3 text-sm text-slate-700">
            {assignMessage}
          </div>
        )}

        <Card className="overflow-hidden rounded-[1.65rem] border border-sky-100/80 bg-white/88 shadow-[0_22px_55px_rgba(37,99,235,0.12)]">
          <CardContent className="p-0">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100/80 bg-sky-50/45 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-600 text-white">
                  <Camera className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-600">
                    {isMainModule ? "Accompaniment" : "Incidence & HH Photo"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={exportingEvidence}
                  onClick={() => void downloadFlaggedEaCsv()}
                  className="h-9 rounded-2xl px-4 text-sm"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {exportingEvidence ? "Exporting..." : "Export CSV"}
                </Button>
                {isAdmin && selected.size > 0 && (
                  <Button
                    onClick={() => setAssignModalOpen(true)}
                    className="h-9 rounded-2xl px-4 text-sm"
                  >
                    Assign {selected.size} selected
                  </Button>
                )}
              </div>
            </div>

            {/* Admin history filters */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-4 border-b border-white/60 bg-white/20 px-5 py-3">
                {isMainModule && regionOptions.length > 0 && (
                  <div className="min-w-[220px]">
                    <MultiSelectDropdown
                      label="regions"
                      options={regionOptions}
                      selected={selectedRegions}
                      onChange={setSelectedRegions}
                    />
                  </div>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showHistory}
                    onChange={(e) => setShowHistory(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded"
                  />
                  Show History
                </label>
                {showHistory && (
                  <>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="rounded-[1rem] border border-white/70 bg-white/44 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">All statuses</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">From</span>
                      <input
                        type="date"
                        value={filterDateFrom}
                        onChange={(e) => setFilterDateFrom(e.target.value)}
                        className="rounded-[1rem] border border-white/70 bg-white/44 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <span className="text-xs text-slate-500">To</span>
                      <input
                        type="date"
                        value={filterDateTo}
                        onChange={(e) => setFilterDateTo(e.target.value)}
                        className="rounded-[1rem] border border-white/70 bg-white/44 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">Loading...</div>
            ) : loadError && items.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-rose-600">{loadError}</div>
            ) : visibleItems.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">
                {isMainModule ? "No interviewer accompaniment records found." : "No flagged Wards found."}
              </div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto px-4 pb-4">
                <Table className="border-separate border-spacing-y-2">
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow className="hover:bg-transparent">
                      {isAdmin && (
                        <TableHead className="w-10 rounded-l-2xl bg-white text-slate-800">
                          <input
                            type="checkbox"
                            checked={selected.size === visibleItems.length && visibleItems.length > 0}
                            onChange={toggleSelectAll}
                            className="h-4 w-4 cursor-pointer rounded"
                          />
                        </TableHead>
                      )}
                      {isMainModule ? (
                        <>
                          {sortableHead("State", "state_name", "left", "min-w-[110px]")}
                          {sortableHead("Interviewer", "interviewer_id", "left", "min-w-[190px]")}
                          {sortableHead("Total Interviews", "total_interviews", "right", "min-w-[150px]")}
                          {sortableHead("Accompanied Interviews", "accompanied_interviews", "right", "min-w-[190px]")}
                          {sortableHead("% Accompanied Interviews", "accompanied_pct", "right", "min-w-[210px]")}
                        </>
                      ) : (
                        <>
                          {sortableHead("State", "state_name", "left")}
                          {sortableHead("Ward Name", "ea_name", "left")}
                          {sortableHead("Ward ID", "ea_id", "left")}
                          {sortableHead("% Of Non-Residential", "building_only_pct", "right")}
                          {sortableHead("% Of Residential", "residential_pct", "right")}
                          {sortableHead("% Of Remittance", "remittance_pct", "right")}
                          {sortableHead("Sampled from Remittance", "sampled_from_remittance", "right")}
                        </>
                      )}
                      {sortableHead("Status", "check_status", "center", "min-w-[130px]")}
                      {isAdmin && (
                        sortableHead("Assigned To", "assigned_to_username", "left", "min-w-[150px]")
                      )}
                      <TableHead className="w-10 rounded-r-2xl bg-white" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((row) => (
                      <TableRow
                        key={row.submission_key}
                        className="cursor-pointer rounded-2xl bg-white/72 shadow-sm transition hover:bg-sky-50/80 hover:shadow-md"
                        onClick={() => openDetail(row.submission_key)}
                      >
                        {isAdmin && (
                          <TableCell
                            className="rounded-l-2xl border-y border-l border-slate-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(row.submission_key);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(row.submission_key)}
                              onChange={() => {/* handled by cell onClick */}}
                              className="h-4 w-4 cursor-pointer rounded"
                            />
                          </TableCell>
                        )}
                        {isMainModule ? (
                          <>
                            <TableCell className="border-y border-slate-100 text-left text-slate-700">
                              {row.state_name ?? "-"}
                            </TableCell>
                            <TableCell className="border-y border-slate-100 text-left font-semibold text-slate-950">
                              {row.interviewer_id ?? row.ea_name ?? "-"}
                            </TableCell>
                            <TableCell className="border-y border-slate-100 text-right font-semibold tabular-nums text-slate-800">
                              {(row.total_interviews ?? 0).toLocaleString("en-US")}
                            </TableCell>
                            <TableCell className="border-y border-slate-100 text-right font-semibold tabular-nums text-emerald-700">
                              {(row.accompanied_interviews ?? 0).toLocaleString("en-US")}
                            </TableCell>
                            <TableCell className="border-y border-slate-100 text-right font-semibold tabular-nums text-sky-700">
                              {row.accompanied_pct != null ? `${row.accompanied_pct}%` : "0%"}
                            </TableCell>
                          </>
                        ) : (
                          <>
                        <TableCell className="border-y border-slate-100 font-semibold text-slate-950">
                          {row.state_name ?? "—"}
                        </TableCell>
                        <TableCell className="border-y border-slate-100 text-slate-700">
                          {row.ea_name ?? "—"}
                        </TableCell>
                        <TableCell className="border-y border-slate-100 font-mono text-xs text-slate-600">
                          {row.ea_id ?? "—"}
                        </TableCell>
                        <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-rose-700">
                          {row.building_only_pct != null ? `${row.building_only_pct}%` : "—"}
                        </TableCell>
                        <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-emerald-700">
                          {row.residential_pct != null ? `${row.residential_pct}%` : "—"}
                        </TableCell>
                        <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-blue-700">
                          {row.remittance_pct != null ? `${row.remittance_pct}%` : "—"}
                        </TableCell>
                        <TableCell className="border-y border-slate-100 text-center font-semibold tabular-nums text-slate-800">
                          {row.sampled_from_remittance}
                        </TableCell>
                          </>
                        )}
                        <TableCell className="border-y border-slate-100 text-center">
                          {row.check_status ? (
                            <Badge className={cn("text-xs", STATUS_BADGE[row.check_status] ?? "")}>
                              {row.check_status}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">unassigned</span>
                          )}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="border-y border-slate-100 text-sm text-slate-600">
                            {row.assigned_to_username ?? "—"}
                          </TableCell>
                        )}
                        <TableCell className="rounded-r-2xl border-y border-r border-slate-100 text-center">
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {surveyModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl">
            {surveyLoggingIn ? (
              <div className="py-8 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" />
                <p className="mt-4 text-lg font-semibold text-slate-950">Logging in...</p>
                <p className="mt-2 text-sm text-slate-500">Connecting to SurveyCTO media storage.</p>
              </div>
            ) : (
              <>
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-600">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-xl font-semibold text-slate-950">SurveyCTO Login</h3>
                <p className="mt-2 text-sm text-slate-600">Enter your SurveyCTO credentials to view validation photos.</p>
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
                  <button type="button" onClick={() => setSurveyModalOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
                  <button type="button" onClick={submitSurveyLogin} disabled={!surveyUsername || !surveyPassword} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Login</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Assign Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">Assign to QC Reviewer</h3>
            <p className="mb-4 text-sm text-slate-600">
              Assigning <strong>{selected.size}</strong> Ward{selected.size !== 1 ? "s" : ""} to a reviewer.
            </p>
            <div className="mb-5">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                QC Reviewer
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-[1rem] border border-white/70 bg-white/44 px-3.5 py-2.5 text-sm text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {qcUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.full_name ?? u.username}
                  </option>
                ))}
              </select>
            </div>
            {assignMessage && (
              <p className="mb-4 text-sm text-rose-600">{assignMessage}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleAssign()}
                disabled={assigning || !selectedUserId}
                className="flex-1 rounded-[1rem] bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {assigning ? "Assigning…" : "Assign"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignModalOpen(false);
                  setAssignMessage(null);
                }}
                className="flex-1 rounded-[1rem] border border-white/70 bg-white/44 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-white/60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </PlatformPage>
  );
}
