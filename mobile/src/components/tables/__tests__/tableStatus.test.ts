/**
 * Table Management §C and §E (docs/api-contract.md v1.29): the shared table
 * status and the reservation clash, hold and late rules.
 */
import {
  isReservationHeld,
  isReservationLate,
  RESERVATION_LATE_MINUTES,
  RESERVATION_SLOT_MINUTES,
  reservationsClash,
  tableStatus,
} from '@pos/core/tables/status';
import type { TableReservationSummary, TabSummary } from '@/services/types';

const tab: TabSummary = {
  ulid: '01K7TAB0000000000000000001',
  guests: 3,
  opened_at: '2026-10-26T10:00:00Z',
  opened_by: { id: 3, name: 'Cara' },
  item_count: 2,
  remaining_cents: 12450,
  rounds_count: 1,
  last_round_at: '2026-10-26T10:05:00Z',
  updated_at: '2026-10-26T10:05:00Z',
};

function reservation(isHeld: boolean): TableReservationSummary {
  return { ulid: '01K7RES0000000000000000001', guest_name: 'Santos', party_size: 4, reserved_for: '2026-10-26T11:00:00Z', is_held: isHeld, is_late: false };
}

describe('tableStatus', () => {
  it('occupied wins, then a held reservation, else free', () => {
    expect(tableStatus({ tab, reservation: reservation(true) })).toBe('occupied');
    expect(tableStatus({ tab: null, reservation: reservation(true) })).toBe('reserved');
    expect(tableStatus({ tab: null, reservation: reservation(false) })).toBe('free');
    expect(tableStatus({ tab: null, reservation: null })).toBe('free');
  });
});

describe('reservations', () => {
  it('uses the contract minutes', () => {
    expect(RESERVATION_SLOT_MINUTES).toBe(120);
    expect(RESERVATION_LATE_MINUTES).toBe(15);
  });

  it('clash: less than 120 minutes apart, either way', () => {
    expect(reservationsClash('2026-10-26T11:00:00Z', '2026-10-26T12:59:00Z')).toBe(true);
    expect(reservationsClash('2026-10-26T12:59:00Z', '2026-10-26T11:00:00Z')).toBe(true);
    expect(reservationsClash('2026-10-26T11:00:00Z', '2026-10-26T13:00:00Z')).toBe(false);
    expect(reservationsClash('2026-10-26T11:00:00Z', 'nope')).toBe(false);
  });

  it('held from hold minutes before until the slot ends', () => {
    const at = '2026-10-26T11:00:00Z';
    expect(isReservationHeld(at, 60, new Date('2026-10-26T09:59:59Z'))).toBe(false);
    expect(isReservationHeld(at, 60, new Date('2026-10-26T10:00:00Z'))).toBe(true);
    expect(isReservationHeld(at, 60, new Date('2026-10-26T12:59:59Z'))).toBe(true);
    expect(isReservationHeld(at, 60, new Date('2026-10-26T13:00:00Z'))).toBe(false);
    expect(isReservationHeld(at, 0, new Date('2026-10-26T10:59:00Z'))).toBe(false);
  });

  it('late after 15 minutes', () => {
    const at = '2026-10-26T11:00:00Z';
    expect(isReservationLate(at, new Date('2026-10-26T11:15:00Z'))).toBe(false);
    expect(isReservationLate(at, new Date('2026-10-26T11:15:01Z'))).toBe(true);
  });
});
