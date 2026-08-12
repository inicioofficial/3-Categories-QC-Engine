import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div ref={rootRef} className="relative space-y-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-[1rem] border border-slate-200/80 bg-white/90 px-3 text-sm font-medium text-slate-950",
          "focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span>{selected.length > 0 ? `${selected.length} selected` : `All ${label}`}</span>
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700 ring-1 ring-sky-200"
            >
              {options.find((opt) => opt.value === value)?.label ?? value}
              <button type="button" onClick={() => toggle(value)} className="rounded-full p-0.5 hover:bg-sky-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-[1000] mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="max-h-56 space-y-1 overflow-auto pr-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span>{option.label}</span>
                {selectedSet.has(option.value) && <Check className="h-4 w-4 text-sky-600" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-2 text-xs font-semibold text-rose-600 hover:text-rose-700"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
