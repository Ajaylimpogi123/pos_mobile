import { addBusinessDays, businessDateAt, wallClockIn } from '@pos/core/businessDay';

describe('businessDateAt (branch timezone + day start)', () => {
  // Asia/Manila is UTC+8 all year; the dev branch's day starts at 04:00.
  it('is the local date once the day has started', () => {
    // 2026-09-25 02:00 UTC = 10:00 in Manila.
    expect(businessDateAt(Date.parse('2026-09-25T02:00:00Z'), 'Asia/Manila', '04:00')).toBe('2026-09-25');
    // 2026-09-25 20:00 UTC = 04:00 on the 26th in Manila: the new business day starts exactly now.
    expect(businessDateAt(Date.parse('2026-09-25T20:00:00Z'), 'Asia/Manila', '04:00')).toBe('2026-09-26');
  });

  it('belongs to the previous business day before the day start', () => {
    // 2026-09-25 19:59 UTC = 03:59 on the 26th in Manila → still the 25th's business day.
    expect(businessDateAt(Date.parse('2026-09-25T19:59:00Z'), 'Asia/Manila', '04:00')).toBe('2026-09-25');
    // Just after local midnight.
    expect(businessDateAt(Date.parse('2026-09-30T16:30:00Z'), 'Asia/Manila', '04:00')).toBe('2026-09-30');
  });

  it('uses the branch timezone, not the device clock', () => {
    const now = Date.parse('2026-09-25T13:00:00Z');
    expect(businessDateAt(now, 'Asia/Manila', '00:00')).toBe('2026-09-25');
    expect(businessDateAt(now, 'Pacific/Kiritimati', '00:00')).toBe('2026-09-26');
    expect(wallClockIn('Asia/Manila', now)).toEqual({ year: 2026, month: 9, day: 25, hour: 21, minute: 0 });
  });

  it('falls back to the device clock for an unknown zone', () => {
    expect(wallClockIn('Not/AZone', Date.now())).toBeNull();
    expect(businessDateAt(Date.now(), 'Not/AZone', '00:00')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addBusinessDays', () => {
  it('steps across month and year ends', () => {
    expect(addBusinessDays('2026-09-25', -1)).toBe('2026-09-24');
    expect(addBusinessDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addBusinessDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('returns a malformed label unchanged', () => {
    expect(addBusinessDays('25/09/2026', 1)).toBe('25/09/2026');
  });
});
