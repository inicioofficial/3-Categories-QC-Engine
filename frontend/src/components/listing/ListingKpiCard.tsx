import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const KPI_TONES = {
  neutral: {
    card: "bg-white/72 border-white/82 dark:bg-white/5 dark:border-white/8",
    icon: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400",
    bar: "from-indigo-400 to-violet-400",
    glow: "kpi-glow-indigo",
  },
  success: {
    card: "bg-emerald-50/80 border-emerald-100/80 dark:bg-emerald-950/20 dark:border-emerald-800/20",
    icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
    bar: "from-emerald-400 to-teal-400",
    glow: "kpi-glow-emerald",
  },
  warning: {
    card: "bg-amber-50/80 border-amber-100/80 dark:bg-amber-950/20 dark:border-amber-800/20",
    icon: "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
    bar: "from-amber-400 to-orange-400",
    glow: "kpi-glow-amber",
  },
  danger: {
    card: "bg-rose-50/80 border-rose-100/80 dark:bg-rose-950/20 dark:border-rose-800/20",
    icon: "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400",
    bar: "from-rose-400 to-pink-400",
    glow: "kpi-glow-rose",
  },
} as const;

export function ListingKpiCard({
  label,
  value,
  meta,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  icon: LucideIcon;
  tone?: keyof typeof KPI_TONES;
}) {
  const styles = KPI_TONES[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5",
        styles.card,
        styles.glow,
      )}
    >
      {/* Accent bar */}
      <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", styles.bar)} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 leading-tight mb-2.5">
            {label}
          </p>
          <p className="text-2xl font-semibold leading-none tracking-[-0.03em] text-slate-900 dark:text-slate-100">
            {value}
          </p>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 min-h-[1rem]">
            {meta ?? ""}
          </p>
        </div>
        <div className={cn("shrink-0 rounded-xl p-2.5", styles.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
