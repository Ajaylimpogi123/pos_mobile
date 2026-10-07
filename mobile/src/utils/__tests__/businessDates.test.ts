import { formatBusinessDate, formatClockTime, formatWeekdayShort } from '@/utils/dates';

describe('business-day labels', () => {
  it('reads YYYY-MM-DD as a calendar date (no timezone shift)', () => {
    expect(formatWeekdayShort('2026-09-24')).toBe('Thu');
    expect(formatWeekdayShort('2026-09-18')).toBe('Fri');
    expect(formatBusinessDate('2026-09-24')).toBe('Thu, 24 Sep 2026');
    expect(formatBusinessDate('2026-01-01')).toBe('Thu, 1 Jan 2026');
  });

  it('falls back to the raw label when it is malformed', () => {
    expect(formatWeekdayShort('24/09/2026')).toBe('24/09/2026');
    expect(formatBusinessDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('formatClockTime', () => {
  it('formats a local 12-hour time, or null when unparsable', () => {
    const local = new Date(2026, 8, 24, 15, 5).toISOString();
    expect(formatClockTime(local)).toBe('3:05 PM');
    expect(formatClockTime(new Date(2026, 8, 24, 0, 30).toISOString())).toBe('12:30 AM');
    expect(formatClockTime('nope')).toBeNull();
  });
});
