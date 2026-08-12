import { ArrowRight, Database, Droplets, Sandwich, Wheat } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/app/auth";
import { AppFooter } from "@/components/layout/AppFooter";
import { SURVEY_WORKSPACES } from "@/data/workspaces";
import { clearApiCache } from "@/lib/api";

export function WorkspaceSelectPage() {
  const { selectWorkspace, selectCategory, logout } = useAuth();
  const navigate = useNavigate();
  const workspaceIcons = { spread: Sandwich, "edible-oil": Droplets, "breakfast-cereal": Wheat };

  function openWorkspace(slug: (typeof SURVEY_WORKSPACES)[number]["slug"]) {
    selectWorkspace(slug);
    selectCategory(slug);
    clearApiCache();
    navigate(`/${slug}/overview-demographics`, { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-950">
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-14">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.13),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.10),transparent_42%)]" />
        <section className="relative z-10 w-full max-w-6xl">
          <div className="mb-9 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <img src="/laptop%20(1).png" alt="Inicio Insights" className="h-16 w-24 object-contain" />
                <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-sky-700">BHT Wave 1</span>
              </div>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Select a workspace</h1>
              <p className="mt-3 max-w-2xl text-base text-slate-600">Each category is connected to its own SurveyCTO form and isolated PostgreSQL schema.</p>
            </div>
            <button type="button" onClick={logout} className="self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-sky-200 hover:text-sky-700">Sign out</button>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {SURVEY_WORKSPACES.map((workspace) => {
              const Icon = workspaceIcons[workspace.slug];
              return (
              <button key={workspace.slug} type="button" onClick={() => openWorkspace(workspace.slug)} className="group overflow-hidden rounded-[26px] border border-slate-200 bg-white text-left shadow-[0_20px_55px_rgba(15,23,42,0.08)] transition hover:-translate-y-1 hover:border-sky-200 hover:shadow-[0_24px_65px_rgba(14,165,233,0.15)] focus:outline-none focus:ring-2 focus:ring-sky-400">
                <div className={`h-2 bg-gradient-to-r ${workspace.accent}`} />
                <div className="p-6">
                  <div className="mb-8 flex items-start justify-between">
                    <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${workspace.accent} text-white shadow-lg`}><Icon className="h-6 w-6" /></span>
                    <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-sky-600" />
                  </div>
                  <h2 className="text-2xl font-bold">{workspace.label}</h2>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{workspace.description}</p>
                  <div className="mt-6 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
                    <Database className="h-4 w-4" />
                    <span>{workspace.schema}</span>
                  </div>
                </div>
              </button>
            )})}
          </div>
        </section>
      </main>
      <AppFooter className="bg-white text-slate-500" />
    </div>
  );
}
