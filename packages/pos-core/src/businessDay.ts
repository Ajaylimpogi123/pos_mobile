/**
 * Business days (PROJECT_MEMORY §4.4, contract → Dashboard "Time"): the
 * branch's `timezone`, with the day starting at `day_start_time` (e.g.
 * "04:00"), not at midnight. A sale at 01:30 belongs to the previous
 * business day. Labels are `YYYY-MM-DD`.
 */

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The wall-clock time of `now` in `timeZone`. Hermes supports
 * `Intl.DateTimeFormat#format` with a `timeZone` but not `formatToParts`, so
 * the formatted en-US text ("9/25/2026, 14:05") is parsed. `null` when the
 * zone is unknown or the output can't be read.
 */
export function wallClockIn(timeZone: string, now: number): WallClock | null {
  try {
    const text = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(now));
    const match = /(\d{1,2})\D+(\d{1,2})\D+(\d{4})\D+(\d{1,2})\D+(\d{2})/.exec(text);
    if (!match) return null;
    const [month, day, year, hour, minute] = match.slice(1).map(Number);
    // Some engines print midnight as 24:00 even with h23.
    return { year, month, day, hour: hour === 24 ? 0 : hour, minute };
  } catch {
    return null;
  }
}

/**
 * The wall-clock time of `now` in the branch's `timeZone`, falling back to the
 * device clock when the zone can't be read (printed receipt and ticket times).
 */
export function branchWallClock(timeZone: string, now: number): WallClock {
  return wallClockIn(timeZone, now) ?? deviceWallClock(now);
}

/** The device's own wall clock: the fallback when the branch zone can't be read. */
function deviceWallClock(now: number): WallClock {
  const date = new Date(now);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** "04:00" → 240 minutes after midnight. A malformed value counts as midnight. */
function minutesAfterMidnight(time: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return 0;
  return hours * 60 + minutes;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` from calendar parts. */
function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parses `YYYY-MM-DD` as a UTC calendar date (a label, not an instant). `null` when malformed. */
function parseYmd(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time;
}

/** The business-day label `days` after (or before, when negative) `ymd`. A malformed label is returned as is. */
export function addBusinessDays(ymd: string, days: number): string {
  const time = parseYmd(ymd);
  if (time === null) return ymd;
  const date = new Date(time + days * DAY_MS);
  return formatYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * The business date at `now` for a branch: its wall-clock date in `timeZone`,
 * or the day before when the local time is earlier than `dayStartTime`.
 * Falls back to the device clock if the zone can't be read.
 */
export function businessDateAt(now: number, timeZone: string, dayStartTime: string): string {
  const local = wallClockIn(timeZone, now) ?? deviceWallClock(now);
  const date = formatYmd(local.year, local.month, local.day);
  return local.hour * 60 + local.minute < minutesAfterMidnight(dayStartTime) ? addBusinessDays(date, -1) : date;
}

function clockText(hour: number, minute: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "8:02 AM" in the branch's timezone (e.g. "Shift since 8:02 AM"). `null` for an unreadable timestamp. */
export function formatBranchTime(iso: string, timeZone: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const local = branchWallClock(timeZone, time);
  return clockText(local.hour, local.minute);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "26 Sep 2026, 8:02 AM" in the branch's timezone. `null` for an unreadable timestamp. */
export function formatBranchDateTime(iso: string, timeZone: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const local = branchWallClock(timeZone, time);
  return `${local.day} ${MONTH_NAMES[local.month - 1]} ${local.year}, ${clockText(local.hour, local.minute)}`;
}

/** Whole days from `from` to `to` (`YYYY-MM-DD` labels; negative when `to` is earlier). `null` when malformed. */
export function businessDaysBetween(from: string, to: string): number | null {
  const start = parseYmd(from);
  const end = parseYmd(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / DAY_MS);
}

/** The first day of the month of `ymd` (`2026-09-26` → `2026-09-01`). A malformed label is returned as is. */
export function firstOfMonth(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(0, 8)}01` : ymd;
}
