import { ArrowLeftRight, Droplets, ExternalLink, LogOut, Sandwich, Wheat } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/app/auth";
import { NavLink } from "@/components/NavLink";
import { getSurveyWorkspace } from "@/data/workspaces";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = { title: string; url?: string; externalUrl?: string; children?: NavItem[] };

type AppSidebarProps = {
  navGroups: Array<{ label?: string; collapsible?: boolean; items: NavItem[] }>;
  module?: "listing" | "main";
  onLogout: () => void;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
};

function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => (item.url || item.externalUrl ? [item] : flattenNavItems(item.children ?? [])));
}

export function AppSidebar({ navGroups, module = "listing", onLogout, theme, onThemeChange }: AppSidebarProps) {
  void theme;
  void onThemeChange;
  void module;
  const { selectedWorkspace } = useAuth();
  const navigate = useNavigate();
  const workspace = getSurveyWorkspace(selectedWorkspace);
  const workspaceIcons = { spread: Sandwich, "edible-oil": Droplets, "breakfast-cereal": Wheat };
  const WorkspaceIcon = selectedWorkspace ? workspaceIcons[selectedWorkspace] : Wheat;
  const workspaceUrl = (url: string) => selectedWorkspace && url.startsWith("/main")
    ? url.replace(/^\/main/, `/${selectedWorkspace}`)
    : url;

  return (
    <Sidebar collapsible="offcanvas" className="fixed inset-y-0 left-0 z-30 h-screen shrink-0 overflow-hidden border-r border-slate-200/80 bg-[#f8f9fc]/95 shadow-[18px_0_45px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-sky-200/60 dark:bg-white/86">
      <SidebarHeader className="px-4 pb-2 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex w-full flex-col items-center text-center">
            <div className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${workspace?.accent ?? "from-sky-400 to-blue-600"} text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)]`}>
              <WorkspaceIcon className="h-7 w-7" />
            </div>
            <div className="mt-2 min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-slate-900">{workspace?.label ?? "BHT Platform"}</p>
              <p className="mt-0.5 text-xs text-slate-500">Wave 1 · Nigeria 2026</p>
            </div>
            <button type="button" onClick={() => navigate("/workspace-select")} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 transition hover:border-sky-200 hover:text-sky-700">
              <ArrowLeftRight className="h-3 w-3" /> Change category
            </button>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="!overflow-visible px-0 pt-0">
        {navGroups.map((group) => {
          const groupKey = group.label ?? group.items.map((item) => item.url ?? item.title).join("-");
          const items = flattenNavItems(group.items);
          if (items.length === 0) return null;

          return (
            <SidebarGroup key={groupKey} className="px-0 py-0.5">
              {group.label ? (
                <SidebarGroupLabel className="mb-0 h-auto px-5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                  {group.label}
                </SidebarGroupLabel>
              ) : null}
              <SidebarGroupContent>
                <SidebarMenu className="gap-0">
                  {items.map((item) => (
                    <SidebarMenuItem key={`${item.title}-${item.url ?? item.externalUrl}`}>
                      <SidebarMenuButton asChild className="h-auto p-0">
                        {item.externalUrl ? (
                          <a
                            href={item.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-3 flex min-h-8 max-w-[calc(100%-1.5rem)] items-center justify-between gap-2 overflow-hidden rounded-xl px-4 py-1.5 text-[12.5px] font-semibold leading-tight text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-500 dark:hover:bg-white/60 dark:hover:text-slate-950"
                          >
                            <span>{item.title}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          </a>
                        ) : (
                          <NavLink
                            to={workspaceUrl(item.url!)}
                            end={item.url === "/main" || item.url === "/listing/dashboard"}
                            className="mx-3 flex min-h-8 max-w-[calc(100%-1.5rem)] items-center justify-between overflow-hidden rounded-xl px-4 py-1.5 text-[12.5px] font-semibold leading-tight text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-500 dark:hover:bg-white/60 dark:hover:text-slate-950"
                            activeClassName="!bg-blue-600 !text-white shadow-[0_10px_24px_rgba(37,99,235,0.25)]"
                          >
                            <span>{item.title}</span>
                          </NavLink>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="space-y-2 px-4 pb-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
