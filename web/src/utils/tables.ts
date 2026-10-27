/**
 * Dine-in view helpers: grouping tables by area (the server already orders
 * them by `area`, `sort_order`, `name`), and the elapsed time on a table card.
 * Table Management (v1.29): the page wording, the Floor | Grid choice kept per
 * browser, and the branch wall-clock ↔ instant conversion of the reservation form.
 */
import { wallClockIn } from '@pos/core/businessDay';

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

/** Table Management §A: the tabs' messages while dine-in is off. */
export const BOARD_DINE_IN_OFF = 'Turn on dine-in in Settings to use the board.';
export const RESERVATIONS_DINE_IN_OFF = 'Turn on dine-in in Settings to take reservations.';

/** §F: the floor plan on a phone. */
export const FLOOR_PLAN_PHONE_NOTE = 'Edit the floor plan on a tablet or computer.';

/** §E: reservation limits (guest name 60, phone 20, party 1–99, notes 255; cancel reason 255). */
export const RESERVATION_LIMITS = { guestNameMax: 60, phoneMax: 20, partyMin: 1, partyMax: 99, notesMax: 255, reasonMax: 255 } as const;

/** §A: `reservation_hold_minutes` is 0–240 (default 60). */
export const HOLD_MINUTES_LIMITS = { min: 0, max: 240 } as const;

/** §C: the Sell → Tables view, Floor or Grid, remembered per browser. */
export type TablesViewMode = 'floor' | 'grid';

const VIEW_MODE_KEY = 'pos.tablesViewMode';

export function readTablesViewMode(): TablesViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'floor';
  } catch {
    return 'floor';
  }
}

export function writeTablesViewMode(mode: TablesViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Storage blocked (private mode, quota): the choice lasts for this page only.
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The instant (ISO 8601 UTC) of a wall-clock date and time in the branch's
 * timezone (`"2026-10-26"`, `"19:00"`, `"Asia/Manila"`). `null` when either
 * part is malformed. Falls back to the browser's zone if the branch zone can't be read.
 */
export function branchWallTimeToIso(date: string, time: string, timeZone: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})/.exec(time);
  if (!day || !clock) return null;
  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const [hour, minute] = [Number(clock[1]), Number(clock[2])];
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31 || hour > 23 || minute > 59) return null;
  const target = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  let guess = target;
  for (let step = 0; step < 3; step += 1) {
    const wall = wallClockIn(timeZone, guess);
    if (!wall) return new Date(year, month - 1, dayOfMonth, hour, minute).toISOString();
    const shift = target - Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    if (shift === 0) break;
    guess += shift;
  }
  return new Date(guess).toISOString();
}

/** The branch wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) of an instant: the form's starting values. */
export function isoToBranchWallTime(iso: string, timeZone: string): { date: string; time: string } | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const wall = wallClockIn(timeZone, at);
  if (!wall) {
    const local = new Date(at);
    return {
      date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
      time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    };
  }
  return { date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`, time: `${pad(wall.hour)}:${pad(wall.minute)}` };
}
