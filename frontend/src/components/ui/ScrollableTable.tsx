import * as React from "react";

import { cn } from "@/lib/utils";

interface ScrollableTableProps {
  maxHeight?: number;
  className?: string;
  children?: React.ReactNode;
}

function ScrollableTable({ maxHeight = 850, className, children }: ScrollableTableProps) {
  return (
    <div
      className={cn("w-full", className)}
      style={{
        maxHeight: maxHeight,
        overflow: "auto",
      }}
      role="region"
      aria-label="Scrollable table"
      tabIndex={0}
    >
      <table className="w-full caption-bottom text-sm">
        {children}
      </table>
    </div>
  );
}

function ScrollableTableHeader({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-20 bg-white/98 backdrop-blur-sm shadow-[0_2px_4px_rgba(0,0,0,0.08)] [&_tr]:border-b",
        className,
      )}
    >
      {children}
    </thead>
  );
}

const ScrollableTableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  ),
);
ScrollableTableBody.displayName = "ScrollableTableBody";

const ScrollableTableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-white/50 transition-colors data-[state=selected]:bg-muted hover:bg-white/36",
        className,
      )}
      {...props}
    />
  ),
);
ScrollableTableRow.displayName = "ScrollableTableRow";

interface ScrollableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortDir?: "asc" | "desc" | null;
}

const ScrollableTableHead = React.forwardRef<HTMLTableCellElement, ScrollableTableHeadProps>(
  ({ className, sortDir, children, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-12 px-4 text-left align-middle font-medium",
        "text-[11px] uppercase tracking-[0.22em] text-slate-500",
        props.onClick && "cursor-pointer select-none hover:text-slate-700",
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1.5">
        {children}
        {props.onClick && (
          <span className="text-[10px] text-slate-400">
            {sortDir === "asc" ? "▲" : sortDir === "desc" ? "▼" : ""}
          </span>
        )}
      </span>
    </th>
  ),
);
ScrollableTableHead.displayName = "ScrollableTableHead";

const ScrollableTableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("p-4 align-middle text-slate-700", className)}
      {...props}
    />
  ),
);
ScrollableTableCell.displayName = "ScrollableTableCell";

export {
  ScrollableTable,
  ScrollableTableHeader,
  ScrollableTableBody,
  ScrollableTableRow,
  ScrollableTableHead,
  ScrollableTableCell,
};
