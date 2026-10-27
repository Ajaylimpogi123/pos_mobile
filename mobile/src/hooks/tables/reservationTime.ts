/**
 * Reservation times on the tablet (Table Management §E). The form takes a
 * date and a time of day in the **branch's** timezone; the API takes
 * `reserved_for` as an ISO 8601 UTC instant. Pure helpers, no React.
 */
import { wallClockIn } from '@pos/core/businessDay';

/** The time field moves in quarter hours. */
export const TIME_STEP_MINUTES = 15;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "19:05" → 1145; `null` when malformed. */
export function minutesOfDay(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1145 → "19:05" (wraps around midnight). */
export function timeOfDay(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** "19:00" → "7:00 PM". A malformed value is returned as is. */
export function formatTimeOfDay(hhmm: string): string {
  const minutes = minutesOfDay(hhmm);
  if (minutes === null) return hhmm;
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${pad(minutes % 60)} ${hours < 12 ? 'AM' : 'PM'}`;
}

function utcOfWallClock(ymd: string, hhmm: string): number | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const minutes = minutesOfDay(hhmm);
  if (!date || minutes === null) return null;
  return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Math.floor(minutes / 60), minutes % 60);
}

/** The zone's offset (ms) at `instant`, or `null` when the zone can't be read. */
function offsetAt(timeZone: string, instant: number): number | null {
  const local = wallClockIn(timeZone, instant);
  if (!local) return null;
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // Seconds don't matter: the instants used here are whole minutes.
  return asUtc - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

/**
 * `2026-10-26` + `19:00` in the branch zone → `"2026-10-26T11:00:00Z"`.
 * Falls back to the device's zone when the branch zone can't be read.
 * `null` when the date or time is malformed.
 */
export function branchIso(ymd: string, hhmm: string, timeZone: string): string | null {
  const wall = utcOfWallClock(ymd, hhmm);
  if (wall === null) return null;
  let instant: number;
  const first = offsetAt(timeZone, wall);
  if (first === null) {
    const [year, month, day] = ymd.split('-').map(Number);
    const minutes = minutesOfDay(hhmm) ?? 0;
    instant = new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60).getTime();
  } else {
    instant = wall - first;
    // A second pass settles a daylight-saving edge.
    const second = offsetAt(timeZone, instant);
    if (second !== null && second !== first) instant = wall - second;
  }
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}

/** `reserved_for` → the branch's calendar date and time of day, for the edit form. */
export function branchDateAndTime(iso: string, timeZone: string): { date: string; time: string } | null {
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return null;
  const local = wallClockIn(timeZone, instant);
  const date = local
    ? { year: local.year, month: local.month, day: local.day, hour: local.hour, minute: local.minute }
    : (() => {
        const device = new Date(instant);
        return { year: device.getFullYear(), month: device.getMonth() + 1, day: device.getDate(), hour: device.getHours(), minute: device.getMinutes() };
      })();
  return { date: `${date.year}-${pad(date.month)}-${pad(date.day)}`, time: `${pad(date.hour)}:${pad(date.minute)}` };
}

/** The next quarter hour from `now` in the branch zone: the new-reservation default. */
export function nextQuarterHour(now: number, timeZone: string): { date: string; time: string } {
  const stepMs = TIME_STEP_MINUTES * MINUTE_MS;
  const next = Math.ceil((now + 1) / stepMs) * stepMs;
  return branchDateAndTime(new Date(next).toISOString(), timeZone) ?? { date: new Date(next).toISOString().slice(0, 10), time: '12:00' };
}
