import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch } from "@/lib/api";
import { AppFooter } from "./AppFooter";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { useAuth } from "@/app/auth";

type NavItem = { title: string; url?: string; externalUrl?: string; children?: NavItem[] };
type NavGroup = { label?: string; collapsible?: boolean; items: NavItem[] };

type AppLayoutProps = {
  title: string;
  subtitle: string;
  syncLabel: string;
  topBarActions?: ReactNode;
  plainTopBar?: boolean;
  hideTopBar?: boolean;
  showCountdown?: boolean;
  navGroups: NavGroup[];
  module?: "listing" | "main";
  onLogout: () => void;
  children: ReactNode;
};

type SyncStatusPayload = {
  main?: {
    lastSuccessfulCompletionUtc?: string | null;
    lastRunFinishedAt?: string | null;
    lastStatus?: string | null;
  };
};

function formatLastSynced(value: string | null | undefined) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AppLayout({
  title,
  subtitle,
  syncLabel,
  topBarActions,
  plainTopBar = true,
  hideTopBar = false,
  showCountdown = false,
  navGroups,
  module = "main",
  onLogout,
  children,
}: AppLayoutProps) {
  const { selectedWorkspace } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [activeContentWidth, setActiveContentWidth] = useState<number | null>(null);
  const [lastSyncedLabel, setLastSyncedLabel] = useState("Checking...");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const storedTheme =
      window.localStorage.getItem("project_remittance_dashboard_theme") ??
      window.localStorage.getItem("project_xyz_dashboard_theme");
    return storedTheme === "dark" || storedTheme === "light" ? storedTheme : "light";
  });

  useEffect(() => {
    const storedTheme =
      window.localStorage.getItem("project_remittance_dashboard_theme") ??
      window.localStorage.getItem("project_xyz_dashboard_theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("project_remittance_dashboard_theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function loadSyncStatus() {
      try {
        const payload = await apiFetch<SyncStatusPayload>("/api/sync/status", {}, null, 10000);
        if (cancelled) return;
        setLastSyncedLabel(
          formatLastSynced(payload.main?.lastSuccessfulCompletionUtc ?? payload.main?.lastRunFinishedAt),
        );
      } catch {
        if (!cancelled) {
          setLastSyncedLabel("Unavailable");
        }
      }
    }

    void loadSyncStatus();
    const intervalId = window.setInterval(() => {
      void loadSyncStatus();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const measure = () => {
      const firstChild = Array.from(container.children).find((child) => child instanceof HTMLElement) as HTMLElement | undefined;
      const target = firstChild ?? container;
      const width = Math.round(target.getBoundingClientRect().width || container.getBoundingClientRect().width);
      setActiveContentWidth(width > 0 ? width : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    Array.from(container.children).forEach((child) => {
      if (child instanceof HTMLElement) observer.observe(child);
    });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children, location.pathname]);

  const workspaceUrl = (url: string | undefined) => url && selectedWorkspace && url.startsWith("/main")
    ? url.replace(/^\/main/, `/${selectedWorkspace}`)
    : url;
  const visibleRoutes = navGroups.flatMap((group) =>
    group.items.flatMap((item) => {
      const flatten = (entries: NavItem[]): NavItem[] =>
        entries.flatMap((entry) => (entry.url ? [entry] : flatten(entry.children ?? [])));
      return item.url ? [{ ...item, url: workspaceUrl(item.url) }] : flatten(item.children ?? []).map((entry) => ({ ...entry, url: workspaceUrl(entry.url) }));
    }),
  );
  const matchingRoute = visibleRoutes
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.url && (location.pathname === item.url || location.pathname.startsWith(`${item.url}/`)))
    .sort((left, right) => (right.item.url?.length ?? 0) - (left.item.url?.length ?? 0))[0];
  const currentRouteIndex = matchingRoute?.index ?? -1;
  const fallbackRoute = visibleRoutes[0] ?? null;
  const nextRoute =
    currentRouteIndex >= 0 && visibleRoutes.length > 1
      ? visibleRoutes[(currentRouteIndex + 1) % visibleRoutes.length]
      : fallbackRoute;
  const previousRoute =
    currentRouteIndex >= 0 && visibleRoutes.length > 1
      ? visibleRoutes[(currentRouteIndex - 1 + visibleRoutes.length) % visibleRoutes.length]
      : fallbackRoute;

  return (
    <SidebarProvider defaultOpen style={{ "--sidebar-width": "18.75rem" } as CSSProperties}>
      <div className="relative min-h-screen w-full overflow-hidden bg-transparent md:flex">
        <AppSidebar navGroups={navGroups} module={module} onLogout={onLogout} theme={theme} onThemeChange={setTheme} />
        <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center">
          <div className="flex w-full max-w-5xl items-center justify-center opacity-[0.08] saturate-90">
            <img
              src="/laptop%20(1).png"
              alt=""
              aria-hidden="true"
              className="h-52 w-[22rem] object-contain sm:h-64 sm:w-[28rem] lg:h-72 lg:w-[34rem]"
            />
          </div>
        </div>
        <div className="relative z-10 flex min-h-screen min-w-0 flex-col px-2 pb-1 pt-0 sm:px-3 md:flex-1 md:px-4 md:pb-2 md:pt-0">
          <div className="mb-1 flex items-center gap-2 pt-1 md:hidden">
            <SidebarTrigger className="h-9 w-9 rounded-xl border border-slate-200 bg-white/90 text-slate-800 shadow-sm" />
            <span className="text-sm font-semibold text-slate-700">Menu</span>
          </div>
          {hideTopBar ? null : (
            <TopBar
              title={title}
              subtitle={subtitle}
              module={module}
              navGroups={navGroups}
              topBarActions={topBarActions}
              containerWidth={activeContentWidth}
              theme={theme}
              onThemeChange={setTheme}
              onLogout={onLogout}
              lastSyncedLabel={lastSyncedLabel}
            />
          )}
          <main id="app-main-scroll" ref={mainRef} className={`flex-1 min-w-0 overflow-visible pb-4 ${hideTopBar ? "pt-0" : "pt-0.5"}`}>
            <div ref={contentRef} className="mx-auto w-full max-w-[1600px] min-w-0">
              {children}
            </div>
          </main>
          <AppFooter className="mx-auto w-full max-w-[1600px] min-w-0" />
        </div>
        {nextRoute?.url ? (
          <button
            type="button"
            onClick={() => navigate(nextRoute.url!)}
            className="fixed bottom-4 right-4 z-[90] inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.28)] transition hover:bg-blue-700 sm:right-6"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
        {previousRoute?.url ? (
          <button
            type="button"
            onClick={() => navigate(previousRoute.url!)}
            className="fixed bottom-4 left-4 z-[90] inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/90 px-5 py-3 text-sm font-semibold text-slate-700 shadow-[0_14px_30px_rgba(15,23,42,0.14)] transition hover:bg-white md:left-[19.5rem]"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : null}
      </div>
    </SidebarProvider>
  );
}
