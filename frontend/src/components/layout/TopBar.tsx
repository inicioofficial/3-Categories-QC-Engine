import type { ReactNode } from "react";

type NavItem = { title: string; url?: string; externalUrl?: string; children?: NavItem[] };

type TopBarProps = {
  title: string;
  subtitle?: string;
  module: "listing" | "main";
  navGroups: Array<{ label?: string; items: NavItem[] }>;
  containerWidth?: number | null;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  onLogout: () => void;
  topBarActions?: ReactNode;
  lastSyncedLabel?: string;
};

export function TopBar({
  title,
  subtitle,
  navGroups,
  containerWidth,
  theme,
  onThemeChange,
  onLogout,
  topBarActions,
  lastSyncedLabel,
}: TopBarProps) {
  void navGroups;
  void theme;
  void onThemeChange;
  void onLogout;

  return (
    <header className="sticky top-0 z-10 shrink-0">
      <div
        className="mx-auto flex w-full flex-col gap-2 rounded-[14px] border border-white/70 bg-white/82 px-4 py-1.5 shadow-[0_10px_26px_rgba(37,99,235,0.08)] backdrop-blur-xl dark:border-sky-200/60 dark:bg-white/80 dark:shadow-[0_10px_26px_rgba(37,99,235,0.1)] md:px-5"
        style={containerWidth ? { maxWidth: `${containerWidth}px` } : { maxWidth: "1600px" }}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold leading-tight text-slate-950 dark:text-slate-950 md:text-2xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-600">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          {topBarActions || lastSyncedLabel ? (
            <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
              {lastSyncedLabel ? (
                <div className="rounded-full border border-sky-100 bg-white/75 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
                  <span className="text-slate-400">Last synced:</span>{" "}
                  <span className="text-slate-800">{lastSyncedLabel}</span>
                </div>
              ) : null}
              {topBarActions}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
