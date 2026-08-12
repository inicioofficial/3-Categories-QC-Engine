import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-xl border border-slate-200/80 bg-white/70 px-3.5 py-2 text-sm text-slate-800 shadow-sm ring-offset-background backdrop-blur-sm transition-all",
          "placeholder:text-slate-400",
          "focus-visible:border-indigo-300 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:placeholder:text-slate-500",
          "dark:focus-visible:border-indigo-500/50 dark:focus-visible:bg-white/10 dark:focus-visible:ring-indigo-500/20",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
