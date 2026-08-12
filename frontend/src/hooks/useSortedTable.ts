import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc" | null;

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  const aDate = Date.parse(String(a));
  const bDate = Date.parse(String(b));
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) {
    return aDate - bDate;
  }

  const aNum = Number(a);
  const bNum = Number(b);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return aNum - bNum;
  }

  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

export function useSortedTable<T>(rows: T[]) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  function handleSort(key: keyof T) {
    if (sortKey === key) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else if (sortDir === "desc") {
        setSortDir(null);
        setSortKey(null);
      } else {
        setSortDir("asc");
      }
      return;
    }

    setSortKey(key);
    setSortDir("asc");
  }

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return rows;
    return [...rows]
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const a = (left.row as Record<string, unknown>)[String(sortKey)];
        const b = (right.row as Record<string, unknown>)[String(sortKey)];
        const result = compareValues(a, b);
        if (result === 0) return left.index - right.index;
        return sortDir === "asc" ? result : -result;
      })
      .map((entry) => entry.row);
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}
