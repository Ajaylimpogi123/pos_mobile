/**
 * Dine-in Tables & Tabs: wording and grouping shared by the admin list, the
 * Tables view and the tab screen.
 */

/** A table is shown amber once its bill has been open this long (§I). */
export const LONG_SEAT_MINUTES = 90;

export const TABLES_OFFLINE_MESSAGE = 'Tables need a connection.';

export const NO_AREA_LABEL = 'No area';

export type AreaGroup<T> = { key: string; title: string; items: T[] };

/** Groups rows by `area` in the order they arrive (the server orders by area, then sort order and name). */
export function groupByArea<T extends { area: string | null }>(rows: readonly T[]): AreaGroup<T>[] {
  const groups = new Map<string, AreaGroup<T>>();
  for (const row of rows) {
    const area = row.area?.trim() ? row.area.trim() : null;
    const key = area ?? '\u0000none';
    const group = groups.get(key) ?? { key, title: area ?? NO_AREA_LABEL, items: [] };
    group.items.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** "Table 5". */
export function tableLabel(name: string): string {
  return `Table ${name}`;
}

/** "3 guests", "1 guest". */
export function guestsLabel(guests: number): string {
  return `${guests} ${guests === 1 ? 'guest' : 'guests'}`;
}

/** "4 seats", "1 seat". */
export function seatsLabel(seats: number): string {
  return `${seats} ${seats === 1 ? 'seat' : 'seats'}`;
}

/** Whole minutes since `iso` (never below 0; 0 for an unreadable time). */
export function minutesSince(iso: string, now: number): number {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((now - time) / 60_000));
}

/** "12 min", "1 h 05 min". */
export function elapsedLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "Round 2". */
export function roundLabel(roundNo: number): string {
  return `Round ${roundNo}`;
}

// --- Table Management (v1.29) ---------------------------------------------------

/** §C: a table's status word (always shown with its dot; colour is never the only cue). */
export const TABLE_STATUS_LABELS = { free: 'Free', occupied: 'Occupied', reserved: 'Reserved' } as const;

/** §E: a reservation's status word. */
export const RESERVATION_STATUS_LABELS = { booked: 'Booked', seated: 'Seated', cancelled: 'Cancelled', no_show: 'No-show' } as const;

/** §A: the tabs' messages while dine-in is off. */
export const BOARD_DINE_IN_OFF = 'Turn on dine-in in Settings to use the board.';
export const RESERVATIONS_DINE_IN_OFF = 'Turn on dine-in in Settings to take reservations.';

/** §F: the floor plan on a phone. */
export const FLOOR_PLAN_PHONE_NOTE = 'Edit the floor plan on a tablet or computer.';

/** §D: the note under Pending payments. */
export const PENDING_NOTE = 'Before discounts and service charge';

/** "Reserved for Santos · 4 guests · 7:00 PM". */
export function reservedForLabel(guestName: string, partySize: number, time: string): string {
  return `Reserved for ${guestName} · ${guestsLabel(partySize)} · ${time}`;
}
