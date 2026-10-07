import { formatLastLogin, formatRelativeTime, formatShortDate, formatSyncedAgo } from '@/utils/dates';

const NOW = Date.parse('2026-09-24T12:00:00Z');

describe('dates', () => {
  it('formats last_login_at: "Never" for null', () => {
    expect(formatLastLogin(null, NOW)).toBe('Never');
    expect(formatLastLogin('not a date', NOW)).toBe('Unknown');
  });

  it.each([
    ['2026-09-24T11:59:30Z', 'Just now'],
    ['2026-09-24T11:55:00Z', '5 min ago'],
    ['2026-09-24T09:00:00Z', '3 h ago'],
    ['2026-09-23T06:00:00Z', 'Yesterday'],
    ['2026-09-20T12:00:00Z', '4 days ago'],
  ])('formats %s relative to now as "%s"', (iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected);
  });

  it('uses a short date for anything older than a week', () => {
    const iso = '2026-08-01T12:00:00Z';
    expect(formatRelativeTime(iso, NOW)).toBe(formatShortDate(new Date(iso)));
    expect(formatShortDate(new Date(2026, 7, 1))).toBe('1 Aug 2026');
  });

  it.each([
    ['2026-09-24T11:59:30Z', 'Synced just now'],
    // A server clock slightly ahead of the device still reads "just now".
    ['2026-09-24T12:00:20Z', 'Synced just now'],
    ['2026-09-24T11:55:00Z', 'Synced 5 min ago'],
    ['2026-09-24T09:00:00Z', 'Synced 3 h ago'],
    ['2026-09-23T06:00:00Z', 'Synced yesterday'],
    ['2026-09-20T12:00:00Z', 'Synced 4 days ago'],
  ])('formats server_time %s as "%s"', (iso, expected) => {
    expect(formatSyncedAgo(iso, NOW)).toBe(expected);
  });

  it('returns null for an unparsable server_time', () => {
    expect(formatSyncedAgo('nope', NOW)).toBeNull();
  });
});
