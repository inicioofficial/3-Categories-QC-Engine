import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Download, Filter, Search, ShieldAlert, SlidersHorizontal, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { PlatformPage, formatDate, formatToken, statusBadgeClass, truncateValue } from "@/app/platform-page";
import { useAuth } from "@/app/auth";
import { ListingQualityTabs } from "@/components/listing/ListingQualityTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSortedTable } from "@/hooks/useSortedTable";
import type { CaseListItem } from "@/lib/api";
import { exportRowsToExcel } from "@/lib/exportExcel";
import { cn } from "@/lib/utils";
import { matchesSearchTerm } from "@/lib/search";

const SYNTHETIC_LISTING_CASES: CaseListItem[] = [
  { submission_key: "LST-ABJ-0001", ea_id: "ABJ-EA-014", boundary_id: null, interviewer_id: "int_abj_01", supervisor_id: "sup_north_01", approval_status: "pending_review", submission_date: "2026-04-08T09:12:00Z", completion_date: "2026-04-08T13:30:00Z", ea_name: "Garki Central", lga_name: "AMAC", state_name: "Abuja", approved_by: "qc_amina", sample_type: "Main sample", household_count: 142, building_only_count: 18, sampled_household_count: 34, open_issue_count: 3, pending_change_count: 1 },
  { submission_key: "LST-OWR-0002", ea_id: "OWR-EA-022", boundary_id: null, interviewer_id: "int_owr_02", supervisor_id: "sup_south_02", approval_status: "approved", submission_date: "2026-04-09T08:45:00Z", completion_date: "2026-04-09T12:50:00Z", ea_name: "Ikenegbu Layout", lga_name: "Owerri Municipal", state_name: "Imo", approved_by: "qc_dayo", sample_type: "Replacement sample", household_count: 128, building_only_count: 11, sampled_household_count: 29, open_issue_count: 0, pending_change_count: 0 },
  { submission_key: "LST-IBD-0003", ea_id: "IBD-EA-018", boundary_id: null, interviewer_id: "int_ibd_04", supervisor_id: "sup_west_01", approval_status: "in_review", submission_date: "2026-04-10T10:20:00Z", completion_date: "2026-04-10T15:15:00Z", ea_name: "Bodija Market", lga_name: "Ibadan North", state_name: "Oyo", approved_by: "qc_tola", sample_type: "Main sample", household_count: 156, building_only_count: 24, sampled_household_count: 37, open_issue_count: 5, pending_change_count: 2 },
  { submission_key: "LST-PHC-0004", ea_id: "PHC-EA-031", boundary_id: null, interviewer_id: "int_phc_03", supervisor_id: "sup_south_01", approval_status: "corrected", submission_date: "2026-04-11T09:05:00Z", completion_date: "2026-04-11T14:44:00Z", ea_name: "Rumuola Axis", lga_name: "Port Harcourt", state_name: "Rivers", approved_by: "qc_ife", sample_type: "Main sample", household_count: 133, building_only_count: 20, sampled_household_count: 31, open_issue_count: 2, pending_change_count: 1 },
  { submission_key: "LST-KAN-0005", ea_id: "KAN-EA-011", boundary_id: null, interviewer_id: "int_kan_05", supervisor_id: "sup_north_02", approval_status: "rejected", submission_date: "2026-04-12T07:55:00Z", completion_date: "2026-04-12T11:20:00Z", ea_name: "Tarauni Ward", lga_name: "Tarauni", state_name: "Kano", approved_by: "qc_bello", sample_type: "Boost sample", household_count: 119, building_only_count: 33, sampled_household_count: 21, open_issue_count: 8, pending_change_count: 4 },
  { submission_key: "LST-ILR-0006", ea_id: "ILR-EA-027", boundary_id: null, interviewer_id: "int_ilr_02", supervisor_id: "sup_west_02", approval_status: "submitted", submission_date: "2026-04-13T08:10:00Z", completion_date: "2026-04-13T12:18:00Z", ea_name: "Tanke Corridor", lga_name: "Ilorin South", state_name: "Kwara", approved_by: null, sample_type: "Main sample", household_count: 121, building_only_count: 14, sampled_household_count: 27, open_issue_count: 1, pending_change_count: 0 },
  { submission_key: "LST-WRR-0007", ea_id: "WRR-EA-019", boundary_id: null, interviewer_id: "int_wrr_01", supervisor_id: "sup_south_03", approval_status: "approved", submission_date: "2026-04-14T08:40:00Z", completion_date: "2026-04-14T13:02:00Z", ea_name: "Effurun Central", lga_name: "Uvwie", state_name: "Delta", approved_by: "qc_ife", sample_type: "Main sample", household_count: 137, building_only_count: 16, sampled_household_count: 32, open_issue_count: 0, pending_change_count: 0 },
  { submission_key: "LST-BEN-0008", ea_id: "BEN-EA-024", boundary_id: null, interviewer_id: "int_ben_04", supervisor_id: "sup_south_04", approval_status: "pending_review", submission_date: "2026-04-15T09:30:00Z", completion_date: "2026-04-15T14:05:00Z", ea_name: "Ugbowo Gate", lga_name: "Ovia North-East", state_name: "Edo", approved_by: "qc_tola", sample_type: "Replacement sample", household_count: 126, building_only_count: 17, sampled_household_count: 28, open_issue_count: 4, pending_change_count: 2 },
];

const SYNTHETIC_LISTING_CASE_POOL: CaseListItem[] = [
  ...SYNTHETIC_LISTING_CASES,
  ...Array.from({ length: 40 }, (_, index) => {
    const states = ["FCT", "Imo", "Oyo", "Rivers", "Kano", "Kwara", "Delta", "Edo", "Ogun", "Enugu"];
    const status = ["pending_review", "approved", "in_review", "corrected", "rejected", "submitted"][index % 6];
    const state = states[index % states.length];
    return {
      submission_key: `LST-${state}-${String(index + 9).padStart(4, "0")}`,
      ea_id: `${state}-EA-${String(index + 41).padStart(3, "0")}`,
      boundary_id: null,
      interviewer_id: `int_${String((index % 18) + 1).padStart(3, "0")}`,
      supervisor_id: `sup_${String((index % 6) + 1).padStart(2, "0")}`,
      approval_status: status,
      submission_date: `2026-04-${String((index % 20) + 1).padStart(2, "0")}T09:00:00Z`,
      completion_date: `2026-04-${String((index % 20) + 1).padStart(2, "0")}T13:30:00Z`,
      ea_name: `${state} Listing Block ${index + 1}`,
      lga_name: `${state} LGA`,
      state_name: state,
      approved_by: status === "submitted" ? null : `qc_${101 + (index % 5)}`,
      sample_type: index % 2 === 0 ? "Main sample" : "Replacement sample",
      household_count: 95 + (index % 70),
      building_only_count: 8 + (index % 24),
      sampled_household_count: 18 + (index % 30),
      open_issue_count: index % 9,
      pending_change_count: index % 4,
    };
  }),
];

function filterSyntheticListingCases(items: CaseListItem[], statuses: string[], searchText: string, dateFrom: string, dateTo: string) {
  const query = searchText.trim().toLowerCase();
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const to = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

  return items.filter((item) => {
    if (statuses.length > 0 && !statuses.includes(item.approval_status)) return false;
    if (query) {
      if (!matchesSearchTerm(item, query, [formatToken(item.approval_status)])) return false;
    }
    const rawDate = item.completion_date ?? item.submission_date;
    const time = rawDate ? new Date(rawDate).getTime() : null;
    if (from != null && (time == null || time < from)) return false;
    if (to != null && (time == null || time > to)) return false;
    return true;
  });
}

function summaryValue(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

type ListingCasesPageProps = {
  module?: "listing" | "main";
};

export function ListingCasesPage({ module = "listing" }: ListingCasesPageProps) {
  const { token, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<CaseListItem[]>([]);
  const [statusFilters, setStatusFilters] = useState(() => {
    const all = searchParams.getAll("status");
    if (all.length > 0) return all;
    const single = searchParams.get("status");
    return single ? [single] : [];
  });
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("date_to") ?? "");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [overviewKpi, setOverviewKpi] = useState({
    targetEas: 0,
    totalEas: 0,
    approvedEas: 0,
    rejectedEas: 0,
    pendingApprovalEas: 0,
    buildingsListed: 0,
    householdRows: 0,
    sampledHouseholds: 0,
  });

  // Bulk delete (admin only)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  const isAdmin = Boolean(user);

  async function loadCases() {
    setItems(filterSyntheticListingCases(SYNTHETIC_LISTING_CASE_POOL, statusFilters, deferredSearch, dateFrom, dateTo));
  }

  useEffect(() => {
    void loadCases();
  }, [token, statusFilters, deferredSearch, dateFrom, dateTo]);

  useEffect(() => {
    async function loadOverviewKpi() {
      try {
        const targetEas = 8000;
        const totalEas = SYNTHETIC_LISTING_CASE_POOL.length;
        const approvedEas = SYNTHETIC_LISTING_CASE_POOL.filter((item) => item.approval_status === "approved").length;
        const rejectedEas = SYNTHETIC_LISTING_CASE_POOL.filter((item) => item.approval_status === "rejected").length;
        const pendingApprovalEas = Math.max(totalEas - approvedEas - rejectedEas, 0);
        const buildingsListed = SYNTHETIC_LISTING_CASE_POOL.reduce((sum, item) => sum + item.building_only_count, 0);
        const householdRows = SYNTHETIC_LISTING_CASE_POOL.reduce((sum, item) => sum + item.household_count, 0);
        const sampledHouseholds = SYNTHETIC_LISTING_CASE_POOL.reduce((sum, item) => sum + item.sampled_household_count, 0);
        setOverviewKpi({ targetEas, totalEas, approvedEas, rejectedEas, pendingApprovalEas, buildingsListed, householdRows, sampledHouseholds });
      } catch {
        // silently ignore
      }
    }
    void loadOverviewKpi();
  }, [token]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    statusFilters.forEach((status) => nextParams.append("status", status));
    if (deferredSearch) nextParams.set("search", deferredSearch);
    if (dateFrom) nextParams.set("date_from", dateFrom);
    if (dateTo) nextParams.set("date_to", dateTo);

    if (searchParams.toString() !== nextParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [deferredSearch, searchParams, setSearchParams, statusFilters, dateFrom, dateTo]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [items]);

  // KPI values derived from filtered items
  const kpi = useMemo(() => {
    const approved = items.filter((i) => i.approval_status === "approved").length;
    const rejected = items.filter((i) => i.approval_status === "rejected").length;
    const pending = items.length - approved - rejected;
    const buildings = items.reduce((s, i) => s + (i.building_only_count ?? 0), 0);
    const households = items.reduce((s, i) => s + (i.household_count ?? 0), 0);
    const sampled = items.reduce((s, i) => s + (i.sampled_household_count ?? 0), 0);
    return { total: items.length, approved, rejected, pending, buildings, households, sampled };
  }, [items]);

  const detailQueryString = useMemo(() => {
    const query = new URLSearchParams();
    statusFilters.forEach((status) => query.append("status", status));
    if (deferredSearch) query.set("search", deferredSearch);
    const value = query.toString();
    return value ? `?${value}` : "";
  }, [deferredSearch, statusFilters]);
  const caseDetailBasePath = module === "main" ? "/main/listing-cases" : "/listing/cases";

  const { sorted: sortedItems, sortKey, sortDir, handleSort } = useSortedTable(items);
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * pageSize, page * pageSize), [page, sortedItems]);

  const queueSubmissionKeys = useMemo(() => items.map((item) => item.submission_key), [items]);

  // Bulk select helpers
  const allPageSelected = items.length > 0 && items.every((i) => selectedKeys.has(i.submission_key));
  function toggleAll() {
    if (allPageSelected) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        items.forEach((i) => next.delete(i.submission_key));
        return next;
      });
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        items.forEach((i) => next.add(i.submission_key));
        return next;
      });
    }
  }
  function toggleOne(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      setItems((current) => current.filter((item) => !selectedKeys.has(item.submission_key)));
      setDeleteResult(`${selectedKeys.size} case(s) deleted.`);
      setSelectedKeys(new Set());
      setDeleteConfirmOpen(false);
      void loadCases();
    } catch (e) {
      setDeleteResult(`Error: ${e instanceof Error ? e.message : "Request failed."}`);
    } finally {
      setDeleting(false);
    }
  }

  function handleApproveSelected() {
    setItems((current) =>
      current.map((item) =>
        selectedKeys.has(item.submission_key)
          ? {
              ...item,
              approval_status: "approved",
              approved_by: user?.fullName ?? user?.username ?? "Current reviewer",
              open_issue_count: 0,
              pending_change_count: 0,
            }
          : item,
      ),
    );
    setDeleteResult(`${selectedKeys.size} case(s) approved.`);
    setSelectedKeys(new Set());
  }

  function formatCompact(value: number) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }

  function formatFull(value: number) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function handleExportTable() {
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "");
    exportRowsToExcel({
      rows: sortedItems,
      columns: [
        { header: "Submission Key", value: (row) => row.submission_key, width: 26 },
        { header: "Ward ID", value: (row) => row.ea_id, width: 16 },
        { header: "Ward Name", value: (row) => row.ea_name ?? row.ea_id, width: 28 },
        { header: "LGA", value: (row) => row.lga_name ?? "-", width: 18 },
        { header: "State", value: (row) => row.state_name ?? "-", width: 18 },
        { header: "Approval By", value: (row) => row.approved_by ?? "-", width: 28 },
        { header: "Status", value: (row) => formatToken(row.approval_status), width: 16 },
        { header: "Households", value: (row) => row.household_count, width: 12 },
        { header: "Sampled Households", value: (row) => row.sampled_household_count, width: 18 },
        { header: "Buildings", value: (row) => row.building_only_count ?? 0, width: 12 },
        { header: "QC Load", value: (row) => row.open_issue_count, width: 12 },
        { header: "Updated", value: (row) => formatDate(row.completion_date ?? row.submission_date), width: 22 },
        { header: "Sample Type", value: (row) => row.sample_type ?? "Listing submission", width: 18 },
      ],
      filename: `listing-review-cases-${timestamp}.xlsx`,
      sheetName: "Listing Review Cases",
    });
  }

  return (
    <PlatformPage
      title="Listing Data Explorer"
      subtitle=""
      syncLabel=""
      module={module}
    >
      <div className="space-y-6">
        <ListingQualityTabs />

        {/* KPI Cards — from overview endpoint, same values as Overview page */}
        <button type="button" onClick={() => setFilterModalOpen(true)} className="inline-flex w-fit items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.25)] hover:bg-sky-700">
          <Filter className="h-4 w-4" />
          Control filters
        </button>
        <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
          <DialogContent className="max-w-5xl rounded-3xl border-white/70 bg-white/95 p-0">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Listing Data Explorer filters</DialogTitle>
            </DialogHeader>
        <Card className="overflow-hidden rounded-[1.5rem] border border-sky-100/80 bg-white/90 text-slate-950 shadow-[0_18px_48px_rgba(37,99,235,0.12)]">
          <CardContent className="p-0">
            <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end">
              <div className="flex min-w-[220px] items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500 text-white">
                  <Filter className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600">Control filters</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">Review queue controls</h3>
                </div>
              </div>

              <div className="grid flex-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)_140px_140px_auto]">
                <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-700">Status</label>
                <MultiSelectDropdown
                  label="statuses"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={[
                    { value: "submitted", label: "Submitted" },
                    { value: "pending_review", label: "Pending Review" },
                    { value: "in_review", label: "In Review" },
                    { value: "corrected", label: "Corrected" },
                    { value: "approved", label: "Approved" },
                    { value: "rejected", label: "Rejected" },
                  ]}
                />
                </div>

                <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-700">Search</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search any table column"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="border-white/20 bg-white text-slate-950 pl-11 placeholder:text-slate-500"
                  />
                </div>
                </div>

                <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-700">Date from</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/20 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                </div>
                <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-700">Date to</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/20 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={() => { void loadCases(); setFilterModalOpen(false); }} className="h-10 rounded-xl border-sky-300/40 bg-sky-500 text-white hover:bg-sky-600">
                    <SlidersHorizontal className="mr-2 h-4 w-4" />
                    Apply
                  </Button>
                </div>
              </div>
            </div>
            {(dateFrom || dateTo || statusFilters.length > 0 || search) && (
              <div className="border-t border-sky-100/80 bg-sky-50/45 px-5 py-3">
                <button
                  type="button"
                  onClick={() => { setDateFrom(""); setDateTo(""); setStatusFilters([]); setSearch(""); }}
                  className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-sky-50"
                >
                  Reset all filters
                </button>
              </div>
            )}
            {false && (
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
          </CardContent>
        </Card>
          </DialogContent>
        </Dialog>

        {/* Bulk action bar */}
        {isAdmin && selectedKeys.size > 0 && (
          <div className="flex items-center gap-3 rounded-[1.4rem] border border-white/70 bg-white/60 px-4 py-3 shadow-sm">
            <span className="text-sm font-semibold text-slate-700">{selectedKeys.size} selected</span>
            {deleteResult && (
              <span className="text-xs text-slate-500">{deleteResult}</span>
            )}
            <button
              type="button"
              onClick={handleApproveSelected}
              className="ml-auto flex items-center gap-1.5 rounded-[1rem] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Approve Selected
            </button>
            <button
              type="button"
              onClick={() => { setDeleteResult(null); setDeleteConfirmOpen(true); }}
              className="flex items-center gap-1.5 rounded-[1rem] bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set())}
              className="rounded-[1rem] border border-white/70 bg-white/44 px-3 py-2 text-xs text-slate-500 hover:bg-white/60"
            >
              Clear
            </button>
          </div>
        )}

        {/* Review-ready listing cases explorer */}
        <Card className="glass-panel overflow-hidden rounded-[1.8rem] border-white/70">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/60 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Case explorer</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-900">Listing Data Explorer</h3>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={handleExportTable} className="h-9 rounded-2xl" disabled={sortedItems.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                  {summaryValue(items.length)} cases
                </div>
              </div>
            </div>
            <div className="grid gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { key: "ea_id", label: "Ward" },
                  { key: "state_name", label: "Region" },
                  { key: "approval_status", label: "Status" },
                  { key: "open_issue_count", label: "Auto-flagged QC Issues" },
                ].map((sort) => (
                  <button
                    key={sort.key}
                    type="button"
                    onClick={() => handleSort(sort.key as keyof CaseListItem)}
                    className="rounded-full border border-white/70 bg-white/45 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white/70"
                  >
                    Sort: {sort.label} {sortKey === sort.key ? (sortDir === "asc" ? "up" : "down") : ""}
                  </button>
                ))}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="ml-auto rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    {allPageSelected ? "Clear page selection" : "Select all visible"}
                  </button>
                ) : null}
                <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/45 px-2 py-1 text-xs font-semibold text-slate-600">
                  <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full px-2 py-1 hover:bg-white/70">Prev</button>
                  <span>Page {page} / {totalPages}</span>
                  <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-full px-2 py-1 hover:bg-white/70">Next</button>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {pagedItems.map((item) => {
                  const samplePct = Math.min(100, item.household_count > 0 ? (item.sampled_household_count / item.household_count) * 100 : 0);
                  const loadTone = item.open_issue_count >= 5 ? "text-rose-700" : item.open_issue_count >= 2 ? "text-amber-700" : "text-emerald-700";
                  return (
                    <article
                      key={item.submission_key}
                      className={cn(
                        "rounded-[1.35rem] border border-white/70 bg-white/62 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)]",
                        isAdmin && selectedKeys.has(item.submission_key) && "border-sky-300 bg-sky-50/70",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {isAdmin ? <input type="checkbox" checked={selectedKeys.has(item.submission_key)} onChange={() => toggleOne(item.submission_key)} className="mt-1 h-4 w-4 cursor-pointer rounded" /> : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">{truncateValue(item.ea_id, 22)}</p>
                              <h4 className="mt-1 text-lg font-semibold text-slate-950">{item.ea_name ?? item.ea_id}</h4>
                              <p className="mt-1 text-xs text-slate-500">{item.lga_name ?? "-"} · {item.state_name ?? "-"}</p>
                            </div>
                            <Badge variant="outline" className={`border text-[11px] font-semibold ${statusBadgeClass(item.approval_status)}`}>
                              {formatToken(item.approval_status)}
                            </Badge>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Households</p><p className="mt-1 text-lg font-bold text-slate-950">{item.household_count}</p></div>
                            <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Sampled</p><p className="mt-1 text-lg font-bold text-emerald-700">{item.sampled_household_count}</p></div>
                            <div className="rounded-xl bg-slate-50/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Auto-flagged QC Issues</p><p className={`mt-1 text-lg font-bold ${loadTone}`}>{item.open_issue_count}</p></div>
                          </div>
                          <div className="mt-4">
                            <div className="flex items-center justify-between text-xs text-slate-500"><span>Sample progress</span><span>{Math.round(samplePct)}%</span></div>
                            <div className="mt-2 h-2.5 rounded-full bg-slate-200/80"><div className="h-2.5 rounded-full bg-gradient-to-r from-sky-500 to-emerald-500" style={{ width: `${samplePct}%` }} /></div>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
                            <div className="text-xs text-slate-500"><span className="font-semibold text-slate-700">Owner:</span> {item.approved_by ?? "Unassigned"} · {formatDate(item.completion_date ?? item.submission_date)}</div>
                            <Link to={{ pathname: `${caseDetailBasePath}/${encodeURIComponent(item.submission_key)}`, search: detailQueryString }} state={{ queueSubmissionKeys }} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700">Open case</Link>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hidden glass-panel overflow-hidden rounded-[1.8rem] border-white/70">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/60 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Submission queue</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Review-ready listing cases</h3>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={handleExportTable} className="h-9 rounded-2xl" disabled={sortedItems.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
                <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-xs text-slate-600">
                  {summaryValue(items.length)} rows
                </div>
              </div>
            </div>

            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm">
                  <TableRow className="border-white/60 hover:bg-transparent">
                    {isAdmin && (
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 cursor-pointer rounded"
                        />
                      </TableHead>
                    )}
                    <TableHead className="cursor-pointer" onClick={() => handleSort("ea_id")}>Ward ID {sortKey === "ea_id" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("ea_name")}>Ward and location {sortKey === "ea_name" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("state_name")}>State {sortKey === "state_name" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("approved_by")}>Approval By {sortKey === "approved_by" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("approval_status")}>Status {sortKey === "approval_status" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("household_count")}>Progress {sortKey === "household_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("open_issue_count")}>QC load {sortKey === "open_issue_count" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort("completion_date")}>Updated {sortKey === "completion_date" ? (sortDir === "asc" ? "▲" : "▼") : ""}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedItems.map((item) => {
                    const totalLoad = item.open_issue_count;
                    const loadTone =
                      totalLoad >= 5 ? "text-rose-700" : totalLoad >= 2 ? "text-amber-700" : "text-emerald-700";

                    return (
                      <TableRow
                        key={item.submission_key}
                        className={cn(
                          "border-white/50 transition-colors hover:bg-white/30",
                          isAdmin && selectedKeys.has(item.submission_key) && "bg-sky-50/40",
                        )}
                      >
                        {isAdmin && (
                          <TableCell
                            className="py-4 align-top"
                            onClick={(e) => { e.stopPropagation(); toggleOne(item.submission_key); }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(item.submission_key)}
                              onChange={() => {/* handled by cell onClick */}}
                              className="h-4 w-4 cursor-pointer rounded"
                            />
                          </TableCell>
                        )}
                        <TableCell className="py-4 align-top">
                          <Link
                            to={{
                              pathname: `${caseDetailBasePath}/${encodeURIComponent(item.submission_key)}`,
                              search: detailQueryString,
                            }}
                            state={{ queueSubmissionKeys }}
                            className="inline-flex flex-col gap-1"
                          >
                            <span className="font-mono text-xs text-sky-700 transition-colors hover:text-rose-700">
                              {truncateValue(item.ea_id, 22)}
                            </span>
                            <span className="text-xs text-slate-500">Open case workspace</span>
                          </Link>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-slate-900">{item.ea_name ?? item.ea_id}</div>
                            <div className="text-xs text-slate-500">
                              {item.lga_name ?? "-"}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">{item.ea_id}</div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <span className="text-sm text-slate-700">{item.state_name ?? "-"}</span>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <span className="text-sm text-slate-700">{item.approved_by ?? "-"}</span>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <Badge variant="outline" className={`border text-[11px] font-medium ${statusBadgeClass(item.approval_status)}`}>
                            {formatToken(item.approval_status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-slate-500">
                              <span>Households {item.household_count}</span>
                              <span>Sampled {item.sampled_household_count}</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-200/80">
                              <div
                                className="h-2 rounded-full bg-gradient-to-r from-primary to-rose-500"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    item.household_count > 0 ? (item.sampled_household_count / item.household_count) * 100 : 0,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <div className="flex items-start gap-2">
                            <ShieldAlert className="mt-0.5 h-4 w-4 text-rose-500" />
                            <div>
                              <p className={`text-sm font-semibold ${loadTone}`}>{totalLoad} active items</p>
                              <p className="text-xs text-slate-500">
                                {item.open_issue_count} issues
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <div className="text-sm text-slate-700">{formatDate(item.completion_date ?? item.submission_date)}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.sample_type ?? "Listing submission"}</div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete listing cases</DialogTitle>
            <DialogDescription>
              You are about to delete <strong>{selectedKeys.size}</strong> case(s). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : `Delete ${selectedKeys.size} case(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PlatformPage>
  );
}
