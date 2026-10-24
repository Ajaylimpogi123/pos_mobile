/**
 * Business-day labels (`YYYY-MM-DD`). A label is a calendar date, not an
 * instant, so it is read in UTC and never shifted by the browser's timezone.
 * Same wording as the tablet's `mobile/src/utils/dates.ts`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type YearMonthDay = { year: number; month: number; day: number };

function parseBusinessDate(ymd: string): YearMonthDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function weekdayIndex(parsed: YearMonthDay): number {
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/** "Mon" for a business day; the label itself when malformed. */
export function formatWeekdayShort(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? WEEKDAYS[weekdayIndex(parsed)] : ymd;
}

/** "Thu, 24 Sep 2026"; the label itself when malformed. */
export function formatBusinessDate(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  if (!parsed) return ymd;
  return `${WEEKDAYS[weekdayIndex(parsed)]}, ${parsed.day} ${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

/** "24 Sep" (a chart axis); the label itself when malformed. */
export function formatDayMonth(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? `${parsed.day} ${MONTHS[parsed.month - 1]}` : ymd;
}

/** "Sat 19" (a 7-day axis). */
export function formatWeekdayDay(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? `${WEEKDAYS[weekdayIndex(parsed)]} ${parsed.day}` : ymd;
}

/**
 * How long ago an instant was: "just now", "5 min ago", "2 h ago", "3 d ago"
 * (Hardening & Pilot: last seen, heartbeat age). `null` for a missing or bad date.
 */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "October 2026" for any business day of that month; the label itself when malformed. */
export function formatMonthYear(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}` : ymd;
}

/** "Oct" (a 12-month axis); the label itself when malformed. */
export function formatMonthShort(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? MONTHS[parsed.month - 1] : ymd;
}

/** "14" (a day-of-month axis); the label itself when malformed. */
export function formatDayNumber(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? String(parsed.day) : ymd;
}

/** "2026"; the label itself when malformed. */
export function formatYear(ymd: string): string {
  const parsed = parseBusinessDate(ymd);
  return parsed ? String(parsed.year) : ymd;
}
