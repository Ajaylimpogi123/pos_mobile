/**
 * Dine-in view helpers: grouping tables by area (the server already orders
 * them by `area`, `sort_order`, `name`), and the elapsed time on a table card.
 */

/** §I wording: the Tables view while offline. */
export const TABLES_OFFLINE_MESSAGE = 'Tables need a connection.';

/** §D.1/§D.3: guests 1–99; tab notes max 255. */
export const TAB_LIMITS = { guestsMin: 1, guestsMax: 99, notesMax: 255 } as const;

/** Tables with no area are listed under this heading. */
export const NO_AREA_LABEL = 'No area';

/** §I: a table card's elapsed time turns amber after this long. */
export const LONG_TABLE_MINUTES = 90;

export type AreaGroup<T> = { key: string; area: string | null; tables: T[] };

/** Groups in the order the areas first appear (the server's order). */
export function groupByArea<T extends { area: string | null }>(tables: readonly T[]): AreaGroup<T>[] {
  const groups = new Map<string, AreaGroup<T>>();
  for (const table of tables) {
    const key = table.area ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { key: key === '' ? '__none__' : key, area: table.area, tables: [] };
      groups.set(key, group);
    }
    group.tables.push(table);
  }
  return [...groups.values()];
}

/** Whole minutes from `iso` to `now` (never negative). */
export function minutesSince(iso: string, now: number): number {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 60_000));
}

/** "5 min", "1 h 05 min". */
export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}
