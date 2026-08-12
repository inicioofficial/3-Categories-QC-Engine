import { cn } from "@/lib/utils";

export type KpiStripItem = {
  label: string;
  value: string | number;
  meta?: string;
  tone?: "blue" | "emerald" | "amber" | "rose" | "slate";
};

const TONE_CLASS: Record<NonNullable<KpiStripItem["tone"]>, string> = {
  blue: "text-blue-700 dark:text-blue-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  rose: "text-rose-700 dark:text-rose-300",
  slate: "text-slate-900 dark:text-slate-100",
};

export function KpiStrip({ items, className }: { items: KpiStripItem[]; className?: string }) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-blue-100/80 bg-white/82 px-4 py-4 shadow-[0_12px_34px_rgba(37,99,235,0.08)] backdrop-blur-xl dark:border-sky-200/60 dark:bg-white/78",
        className,
      )}
    >
      <div className="flex flex-wrap items-stretch gap-y-4">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="flex min-w-[150px] flex-1 items-center">
            <div className="min-w-0 flex-1 px-3">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {item.label}
              </p>
              <p className={cn("mt-1 text-2xl font-bold leading-none tracking-[-0.03em]", TONE_CLASS[item.tone ?? "blue"])}>
                {item.value}
              </p>
              <p className="mt-1 min-h-[1rem] truncate text-[11px] text-slate-500 dark:text-slate-400">
                {item.meta ?? ""}
              </p>
            </div>
            {index < items.length - 1 ? (
              <span className="hidden px-1 text-2xl font-light text-blue-200 dark:text-blue-900/80 md:block" aria-hidden="true">
                |
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
