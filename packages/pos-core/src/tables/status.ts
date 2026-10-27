/**
 * Table status and reservation timing (docs/api-contract.md → Table
 * Management → §C and §E).
 *
 * - `occupied`: the table has an open tab;
 * - `reserved`: no tab, and its reservation `is_held`;
 * - `free`: neither.
 *
 * Reservations: a slot lasts 120 minutes; a booked reservation holds its table
 * from `reservation_hold_minutes` before its time until its slot ends, and is
 * late 15 minutes after its time. Two booked reservations on one table clash
 * when they are less than 120 minutes apart.
 *
 * The server's `is_held` / `is_late` flags are authoritative; these helpers are
 * for the clients' previews (the table picker's clash marks, countdowns).
 */
import type { TableView } from '../contract/types';

export const RESERVATION_SLOT_MINUTES = 120;
export const RESERVATION_LATE_MINUTES = 15;

export type TableStatus = 'free' | 'occupied' | 'reserved';

const MINUTE_MS = 60_000;

/** Contract §C. */
export function tableStatus(table: Pick<TableView, 'tab' | 'reservation'>): TableStatus {
  if (table.tab !== null) return 'occupied';
  if (table.reservation !== null && table.reservation.is_held) return 'reserved';
  return 'free';
}

/** |a − b| < 120 minutes (the §E clash rule). */
export function reservationsClash(aIso: string, bIso: string): boolean {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < RESERVATION_SLOT_MINUTES * MINUTE_MS;
}

/** `reserved_for − holdMinutes ≤ now < reserved_for + 120 min` (for a booked reservation). */
export function isReservationHeld(reservedForIso: string, holdMinutes: number, now: Date): boolean {
  const at = Date.parse(reservedForIso);
  if (Number.isNaN(at)) return false;
  const t = now.getTime();
  return at - holdMinutes * MINUTE_MS <= t && t < at + RESERVATION_SLOT_MINUTES * MINUTE_MS;
}

/** `now > reserved_for + 15 min` (for a booked reservation; display only). */
export function isReservationLate(reservedForIso: string, now: Date): boolean {
  const at = Date.parse(reservedForIso);
  if (Number.isNaN(at)) return false;
  return now.getTime() > at + RESERVATION_LATE_MINUTES * MINUTE_MS;
}
