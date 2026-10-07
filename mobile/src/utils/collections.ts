/** De-duplicates by `keyOf`, keeping the first copy (a record can shift between cursor pages after an edit). */
export function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** De-duplicates by id, keeping the first copy (a record can shift between cursor pages after an edit). */
export function uniqueById<T extends { id: number }>(items: readonly T[]): T[] {
  return uniqueBy(items, (item) => item.id);
}

/** Splits `items` into consecutive groups of at most `size` (no empty groups). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) groups.push(items.slice(start, start + size));
  return groups;
}
