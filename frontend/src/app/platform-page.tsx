import type { ReactNode } from "react";

import { AppLayout } from "@/components/layout/AppLayout";

import { useAuth } from "./auth";

type NavItem = { title: string; url?: string; externalUrl?: string; children?: NavItem[] };

const LISTING_NAV_GROUPS: Array<{ label: string; collapsible?: boolean; items: NavItem[] }> = [
  {
    label: "Overview",
    items: [{ title: "Overview - Demographics", url: "/listing/dashboard" }, { title: "Geospatial View", url: "/listing/map" }, { title: "Sampling Section", url: "/listing/sampling" }],
  },
  {
    label: "Quality Control",
    items: [
      { title: "Incidence & HH Photo", url: "/listing/picture-check" },
      { title: "In-Office QC Performance", url: "/listing/qc-productivity" },
      { title: "Enumerator Performance", url: "/listing/interviewer" },
    ],
  },
];

const ADMIN_NAV_GROUP = {
  label: "Administration",
  items: [{ title: "User Management", url: "/admin/users" }],
};

const MAIN_NAV_GROUPS_BASE = [
  { title: "Overview - Demographics", url: "/main/overview-demographics" },
  { title: "Geospatial View", url: "/main/geospatial-view" },
  { title: "Quota", externalUrl: "https://quota-tracker.inicio-insights.com/" },
];

export function PlatformPage({
  title,
  subtitle,
  syncLabel,
  module = "main",
  topBarActions,
  plainTopBar = true,
  hideTopBar = false,
  showCountdown = false,
  children,
}: {
  title: string;
  subtitle: string;
  syncLabel: string;
  module?: "listing" | "main";
  topBarActions?: ReactNode;
  plainTopBar?: boolean;
  hideTopBar?: boolean;
  showCountdown?: boolean;
  children: ReactNode;
}) {
  const { logout, user } = useAuth();
  const isSuperadmin = user?.role === "SUPERADMIN";
  const canManageUsers = isSuperadmin || user?.role === "PDM-ADMIN";

  const mainOverviewGroup = { label: "Overview", items: MAIN_NAV_GROUPS_BASE };
  const mainQualityControlGroup = {
    label: "Quality Control",
    items: [
      { title: "Accompaniment", url: "/main/accompaniment" },
      { title: "Enumerator Performance", url: "/main/enumerator-analysis" },
      { title: "Main Data Explorer", url: "/main/cases" },
      { title: "Respondent Recontact Section", url: "/main/callbacks" },
      { title: "Silent Listening Section", url: "/main/audio-listening" },
      { title: "In-Office QC Performance", url: "/main/qc-productivity" },
    ],
  };
  const mainInsightsExportGroup = {
    label: "INSIGHTS & EXPORT",
    items: [
      { title: "Custom Tables", url: "/main/custom-tables" },
      { title: "Verbatims", url: "/main/verbatims" },
    ],
  };

  const mainBaseGroups = [
    mainOverviewGroup,
    mainQualityControlGroup,
    ...(mainInsightsExportGroup.items.length ? [mainInsightsExportGroup] : []),
  ];

  const mainNavGroups = canManageUsers ? [...mainBaseGroups, ADMIN_NAV_GROUP] : mainBaseGroups;
  const listingNavGroups = canManageUsers ? [...LISTING_NAV_GROUPS, ADMIN_NAV_GROUP] : LISTING_NAV_GROUPS;

  return (
    <AppLayout
      title={title}
      subtitle={subtitle}
      syncLabel={syncLabel}
      topBarActions={topBarActions}
      plainTopBar={plainTopBar}
      hideTopBar={hideTopBar}
      showCountdown={showCountdown}
      navGroups={module === "main" ? mainNavGroups : listingNavGroups}
      module={module}
      onLogout={logout}
    >
      {children}
    </AppLayout>
  );
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatToken(value: string | null | undefined) {
  if (!value) return "-";
  return String(value)
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function truncateValue(value: string | null | undefined, max: number) {
  const safeValue = value == null ? "-" : String(value);
  if (safeValue.length <= max) return safeValue;
  return `${safeValue.slice(0, max)}...`;
}

export function MetricLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-inset flex items-center justify-between rounded-[1.25rem] px-4 py-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[1.6rem] border border-dashed border-white/70 bg-white/32 p-6 text-center text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
      <p className="font-medium text-slate-800">{title}</p>
      <p className="mt-2 leading-6 text-slate-500">{message}</p>
    </div>
  );
}

export const SELECT_CLASS =
  "flex h-11 w-full cursor-pointer rounded-[1.15rem] border border-slate-200/80 bg-white/90 px-3.5 py-2 text-sm font-medium text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-ring";

export const INPUT_CLASS =
  "h-11 rounded-[1.15rem] border-slate-200/80 bg-white/90 font-medium text-slate-950 placeholder:text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] focus-visible:ring-2 focus-visible:ring-ring";

const STATUS_BADGE_MAP: Record<string, string> = {
  approved: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700",
  submitted: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  pending_review: "border-amber-500/30 bg-amber-500/12 text-amber-700",
  pending: "border-amber-500/30 bg-amber-500/12 text-amber-700",
  in_review: "border-rose-500/25 bg-rose-500/10 text-rose-700",
  rejected: "border-rose-500/35 bg-rose-500/15 text-rose-800",
  corrected: "border-violet-500/30 bg-violet-500/10 text-violet-700",
};

export function statusBadgeClass(status: string): string {
  return STATUS_BADGE_MAP[status] ?? "border-slate-300 bg-white/45 text-slate-700";
}
