/**
 * Table Management (docs/api-contract.md v1.29) on the tablet: reservation
 * times in the branch zone, the reservation form checks and clash marks, the
 * board's sort and filter, the floor plan editor's messages and free spot,
 * the hold minutes setting and the tile model.
 */
import { tableTileModel } from '@/components/tables/tableTileModel';
import { HOLD_MINUTES_RANGE_MESSAGE, parseHoldMinutes } from '@/hooks/settings/useDineInSettingsForm';
import { branchDateAndTime, branchIso, formatTimeOfDay, nextQuarterHour, timeOfDay } from '@/hooks/tables/reservationTime';
import { firstFreeCell, layoutIssueMessages, type EditorTable } from '@/hooks/tables/useFloorPlanEditor';
import {
  changedReservationFields,
  checkReservationDraft,
  clashingTableIds,
  RESERVED_FOR_RANGE_MESSAGE,
  type ReservationDraft,
} from '@/hooks/tables/useReservations';
import { sortBoardRows, unpaidOnly } from '@/hooks/tables/useTablesBoard';
import type { Reservation, TabSummary } from '@/services/types';
import { makeDiningTable, makeTableView } from '@/test-utils/tabs';

const MANILA = 'Asia/Manila';

describe('reservation times (branch zone)', () => {
  it('turns a Manila date and time into UTC and back', () => {
    expect(branchIso('2026-10-26', '19:00', MANILA)).toBe('2026-10-26T11:00:00Z');
    expect(branchIso('2026-10-27', '01:30', MANILA)).toBe('2026-10-26T17:30:00Z');
    expect(branchDateAndTime('2026-10-26T17:30:00Z', MANILA)).toEqual({ date: '2026-10-27', time: '01:30' });
    expect(branchIso('2026-10-26', '25:00', MANILA)).toBeNull();
  });

  it('reads and steps times of day', () => {
    expect(formatTimeOfDay('19:00')).toBe('7:00 PM');
    expect(formatTimeOfDay('00:15')).toBe('12:15 AM');
    expect(timeOfDay(-15)).toBe('23:45');
    expect(timeOfDay(24 * 60 + 30)).toBe('00:30');
  });

  it('starts a new booking at the next quarter hour', () => {
    expect(nextQuarterHour(Date.parse('2026-10-26T10:07:00Z'), MANILA)).toEqual({ date: '2026-10-26', time: '18:15' });
    expect(nextQuarterHour(Date.parse('2026-10-26T10:15:00Z'), MANILA)).toEqual({ date: '2026-10-26', time: '18:30' });
  });
});

function draft(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    editing: null,
    key: '01K7RES0000000000000000001',
    tableId: 5,
    guestName: ' Santos ',
    phone: '0917 123 4567',
    partySize: 4,
    date: '2026-10-26',
    time: '19:00',
    notes: '',
    ...overrides,
  };
}

describe('reservation form', () => {
  const now = Date.parse('2026-10-26T08:00:00Z');

  it('builds the body with the UTC time', () => {
    expect(checkReservationDraft(draft(), MANILA, now)).toEqual({
      body: { table_id: 5, guest_name: 'Santos', phone: '0917 123 4567', party_size: 4, reserved_for: '2026-10-26T11:00:00Z', notes: null },
      errors: {},
    });
  });

  it('shows the §E rules under their fields', () => {
    const result = checkReservationDraft(draft({ tableId: null, guestName: ' ', phone: 'call me', partySize: 0 }), MANILA, now);
    expect(result.body).toBeNull();
    expect(result.errors).toEqual({
      table_id: 'Pick a table.',
      guest_name: "Enter the guest's name.",
      phone: 'Use numbers, spaces, +, ( ) and - only.',
      party_size: 'Enter 1 to 99 guests.',
    });
  });

  it('takes a time from 15 minutes ago up to 90 days ahead', () => {
    expect(checkReservationDraft(draft({ time: '15:44' }), MANILA, now).errors.reserved_for).toBe(RESERVED_FOR_RANGE_MESSAGE);
    expect(checkReservationDraft(draft({ time: '15:45' }), MANILA, now).errors.reserved_for).toBeUndefined();
    expect(checkReservationDraft(draft({ date: '2027-01-25' }), MANILA, now).errors.reserved_for).toBe(RESERVED_FOR_RANGE_MESSAGE);
  });

  it('marks the tables booked within 120 minutes, ignoring the one being edited', () => {
    const booked = (ulid: string, tableId: number, at: string, status: Reservation['status'] = 'booked') =>
      ({ ulid, status, table: { id: tableId, name: String(tableId), area: null }, reserved_for: at }) as Reservation;
    const others = [
      booked('A', 5, '2026-10-26T12:30:00Z'),
      booked('B', 6, '2026-10-26T13:00:00Z'),
      booked('C', 7, '2026-10-26T10:00:00Z', 'cancelled'),
      booked('D', 8, '2026-10-26T09:30:00Z'),
    ];
    expect([...clashingTableIds('2026-10-26T11:00:00Z', others, null)].sort()).toEqual([5, 8]);
    expect([...clashingTableIds('2026-10-26T11:00:00Z', others, 'A')]).toEqual([8]);
    expect(clashingTableIds(null, others, null).size).toBe(0);
  });
});

function tab(overrides: Partial<TabSummary> = {}): TabSummary {
  return {
    ulid: '01K7TAB0000000000000000001',
    guests: 3,
    opened_at: '2026-10-26T10:00:00Z',
    opened_by: { id: 3, name: 'Cara' },
    item_count: 2,
    remaining_cents: 12450,
    rounds_count: 1,
    last_round_at: '2026-10-26T10:05:00Z',
    updated_at: '2026-10-26T10:05:00Z',
    ...overrides,
  };
}

describe('board', () => {
  const rows = [
    makeTableView({ id: 1, name: '1' }),
    makeTableView({ id: 2, name: '2', tab: tab({ opened_at: '2026-10-26T11:00:00Z', remaining_cents: 0 }) }),
    makeTableView({ id: 3, name: '3', tab: tab({ opened_at: '2026-10-26T09:00:00Z', remaining_cents: 5000 }) }),
    makeTableView({ id: 4, name: '10', tab: tab({ opened_at: '2026-10-26T10:00:00Z', remaining_cents: 9000, last_round_at: null }) }),
  ];
  const ids = (list: { id: number }[]) => list.map((row) => row.id);

  it('starts with time open, oldest first; free tables stay last', () => {
    expect(ids(sortBoardRows(rows, 'open', 'asc'))).toEqual([3, 4, 2, 1]);
    expect(ids(sortBoardRows(rows, 'open', 'desc'))).toEqual([2, 4, 3, 1]);
  });

  it('sorts by unpaid, table name (numeric) and last round', () => {
    expect(ids(sortBoardRows(rows, 'unpaid', 'desc'))).toEqual([4, 3, 2, 1]);
    expect(ids(sortBoardRows(rows, 'table', 'asc'))).toEqual([1, 2, 3, 4]);
    expect(ids(sortBoardRows(rows, 'last_round', 'asc'))).toEqual([2, 3, 1, 4]);
  });

  it('Unpaid only keeps the bills with something to pay', () => {
    expect(ids(unpaidOnly(rows))).toEqual([3, 4]);
  });
});

describe('floor plan editor', () => {
  const table = (id: number, name: string, pos_x: number | null, pos_y: number | null): EditorTable => ({
    ...makeDiningTable({ id, name, pos_x, pos_y }),
    dirty: false,
  });

  it('words the §B problems, marking both tables of an overlap', () => {
    expect(layoutIssueMessages([table(5, '5', 0, 0), table(6, '6', 1, 1), table(7, '7', 23, 0), table(8, '8', 3, null)])).toEqual({
      6: 'Table 6 overlaps Table 5.',
      5: 'Table 5 overlaps Table 6.',
      7: "Table 7 doesn't fit on the plan.",
      8: 'Place the table or leave it off the plan.',
    });
  });

  it('finds the first free spot, row by row', () => {
    expect(firstFreeCell([], 2, 2)).toEqual({ pos_x: 0, pos_y: 0 });
    expect(firstFreeCell([{ id: 1, pos_x: 0, pos_y: 0, width: 3, height: 2 }], 2, 2)).toEqual({ pos_x: 3, pos_y: 0 });
    expect(firstFreeCell([{ id: 1, pos_x: 0, pos_y: 0, width: 6, height: 6 }], 6, 6)).toEqual({ pos_x: 6, pos_y: 0 });
    // Nothing fits a size outside 1–6.
    expect(firstFreeCell([], 7, 1)).toBeNull();
  });
});

describe('hold minutes setting', () => {
  it('takes 0 to 240 whole minutes', () => {
    expect(parseHoldMinutes('60')).toBe(60);
    expect(parseHoldMinutes(' 0 ')).toBe(0);
    expect(parseHoldMinutes('240')).toBe(240);
    expect(parseHoldMinutes('241')).toBeNull();
    expect(parseHoldMinutes('')).toBeNull();
    expect(parseHoldMinutes('1.5')).toBeNull();
    expect(HOLD_MINUTES_RANGE_MESSAGE).toBe('Enter 0 to 240 minutes.');
  });
});

describe('table tiles', () => {
  const time = () => '7:00 PM';
  const now = Date.parse('2026-10-26T12:00:00Z');
  const held = { ulid: 'R', guest_name: 'Santos', party_size: 4, reserved_for: '2026-10-26T11:00:00Z', is_held: true, is_late: false };

  it('shows Reserved for a held free table', () => {
    const model = tableTileModel(makeTableView({ reservation: held }), now, time);
    expect([model.status, model.statusLabel, model.chip]).toEqual(['reserved', 'Reserved', 'pending']);
    expect(model.accessibilityLabel).toBe('Table 5, Reserved, Reserved for Santos · 4 guests · 7:00 PM');
  });

  it('badges an occupied table with a held reservation, amber after 90 minutes', () => {
    const model = tableTileModel(makeTableView({ tab: tab({ opened_at: '2026-10-26T10:30:00Z' }), reservation: held }), now, time);
    expect([model.status, model.long, model.chip, model.reservedBadge]).toEqual(['occupied', true, 'warning', 'Reserved 7:00 PM']);
  });
});

describe('reservation edits (Q-053.8)', () => {
  const original = {
    ulid: 'R1',
    status: 'booked',
    table: { id: 5, name: '5', area: 'Patio' },
    guest_name: 'Santos',
    phone: null,
    party_size: 4,
    reserved_for: '2026-10-26T11:00:00Z',
    notes: null,
  } as Reservation;

  it('sends only the changed fields', () => {
    const body = { table_id: 5, guest_name: 'Santos', phone: null, party_size: 6, reserved_for: '2026-10-26T11:00:00.000Z', notes: null };
    expect(changedReservationFields(original, body)).toEqual({ party_size: 6 });
    expect(changedReservationFields(original, { ...body, party_size: 4 })).toEqual({});
  });

  it("doesn't apply the time window when an edit keeps the time", () => {
    const late = Date.parse('2026-10-26T11:30:00Z');
    expect(checkReservationDraft(draft({ editing: original }), MANILA, late).errors.reserved_for).toBeUndefined();
    expect(checkReservationDraft(draft({ editing: original, time: '18:30' }), MANILA, late).errors.reserved_for).toBe(RESERVED_FOR_RANGE_MESSAGE);
  });
});
