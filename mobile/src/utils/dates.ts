/**
 * Date display helpers. The API sends ISO 8601 UTC strings; these format
 * them in the device's local time, without relying on `Intl` options.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "24 Sep 2026" in local time. */
export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * A short relative time for recent moments, else a short date:
 * "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", "24 Sep 2026".
 * Returns `null` for an unparsable string.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const elapsed = now - time;

  if (elapsed < MINUTE_MS) return 'Just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  if (elapsed < 2 * DAY_MS) return 'Yesterday';
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)} days ago`;
  return formatShortDate(new Date(time));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type YearMonthDay = { year: number; month: number; day: number };

/** Parses a `YYYY-MM-DD` business-day label. `null` when malformed. */
function parseBusinessDate(ymd: string): YearMonthDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Day of the week of a `YYYY-MM-DD` business day ("Mon"). A business-day
 * label is a calendar date, not an instant, so it is read in UTC and never
 * shifted by the device's timezone. Falls back to the label itself.
 */
export function formatWeekdayShort(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  if (!parsed) return ymd;
  return WEEKDAYS[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()];
}

/** "Thu, 24 Sep 2026" for a `YYYY-MM-DD` business day (no timezone shift). Falls back to the label. */
export function formatBusinessDate(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  if (!parsed) return ymd;
  return `${formatWeekdayShort(ymd)}, ${parsed.day} ${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

/** "3:05 PM" in local time. `null` for an unparsable string. */
export function formatClockTime(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** `last_login_at` for display: "Never" when null. */
export function formatLastLogin(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return 'Never';
  return formatRelativeTime(iso, now) ?? 'Unknown';
}

/**
 * The Sell header's sync time: "Synced just now", "Synced 5 min ago",
 * "Synced 3 h ago", "Synced yesterday", "Synced 4 days ago", "Synced 24 Sep 2026".
 * A `server_time` slightly ahead of the device clock reads "just now".
 * `null` for an unparsable string.
 */
export function formatSyncedAgo(iso: string, now: number = Date.now()): string | null {
  const relative = formatRelativeTime(iso, now);
  if (relative === null) return null;
  const startsWithWord = relative === 'Just now' || relative === 'Yesterday';
  return `Synced ${startsWithWord ? relative.toLowerCase() : relative}`;
}
