/** A grid slot: an item, or an empty spacer that keeps the last row's cards the same width. */
export type GridSlot<T> = { key: string; item: T | null };

/** Pads `items` with spacers so the last row of a `columns`-wide grid is full. */
export function toGridSlots<T>(items: readonly T[], columns: number, keyOf: (item: T) => string): GridSlot<T>[] {
  const slots: GridSlot<T>[] = items.map((item) => ({ key: keyOf(item), item }));
  const remainder = slots.length % columns;
  if (remainder > 0) {
    for (let i = 0; i < columns - remainder; i += 1) slots.push({ key: `spacer-${i}`, item: null });
  }
  return slots;
}
