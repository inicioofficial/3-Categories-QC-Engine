import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-emerald-200/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700/30 dark:bg-emerald-950/40 dark:text-emerald-400",
        secondary:
          "border-slate-200/70 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/6 dark:text-slate-400",
        destructive:
          "border-rose-200/60 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-700/30 dark:bg-rose-950/40 dark:text-rose-400",
        outline:
          "border-slate-200 bg-white/60 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
        indigo:
          "border-indigo-200/60 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700/30 dark:bg-indigo-950/40 dark:text-indigo-400",
        amber:
          "border-amber-200/60 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700/30 dark:bg-amber-950/40 dark:text-amber-400",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
