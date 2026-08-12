function collectSearchValues(value: unknown, output: string[], seen: Set<object>) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  if (value instanceof Date) {
    output.push(value.toISOString());
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;

  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSearchValues(entry, output, seen));
  } else {
    Object.values(value).forEach((entry) => collectSearchValues(entry, output, seen));
  }
}

export function matchesSearchTerm(value: unknown, searchTerm: string, extraValues: unknown[] = []) {
  const term = searchTerm.trim().toLocaleLowerCase();
  if (!term) return true;

  const values: string[] = [];
  const seen = new Set<object>();
  collectSearchValues(value, values, seen);
  collectSearchValues(extraValues, values, seen);
  return values.join(" ").toLocaleLowerCase().includes(term);
}
