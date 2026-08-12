import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium ring-offset-background transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_4px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_20px_rgba(99,102,241,0.5)] hover:-translate-y-px active:translate-y-0",
        destructive:
          "bg-rose-500 text-white shadow-[0_4px_14px_rgba(239,68,68,0.25)] hover:bg-rose-600 hover:shadow-[0_4px_20px_rgba(239,68,68,0.35)]",
        outline:
          "border border-slate-200 bg-white/70 text-slate-700 shadow-sm backdrop-blur-sm hover:bg-white hover:border-slate-300 hover:text-slate-900 dark:border-white/12 dark:bg-white/6 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100",
        secondary:
          "border border-slate-200/80 bg-white/60 text-slate-700 shadow-sm backdrop-blur-sm hover:bg-white/90 dark:border-white/10 dark:bg-white/7 dark:text-slate-300 dark:hover:bg-white/12",
        ghost:
          "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-400 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300",
        link: "text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
