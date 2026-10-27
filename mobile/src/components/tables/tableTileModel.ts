/**
 * What a table card or plan tile shows (Dine-in §I, Table Management §C):
 * the status (dot + word), amber after 90 minutes open, and the
 * `Reserved 7:00 PM` badge of an occupied table whose reservation is held.
 */
import {
  elapsedLabel,
  guestsLabel,
  LONG_SEAT_MINUTES,
  minutesSince,
  reservedForLabel,
  seatsLabel,
  TABLE_STATUS_LABELS,
} from '@/components/tables/tableLabels';
import type { ChipVariant } from '@/components/ui/Chip';
import type { TableView } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { tableStatus, type TableStatus } from '@pos/core/tables/status';

export type TableTileModel = {
  status: TableStatus;
  /** Occupied for 90 minutes or more. */
  long: boolean;
  minutes: number;
  statusLabel: string;
  chip: ChipVariant;
  /** `Reserved 7:00 PM` on an occupied table with a held reservation. */
  reservedBadge: string | null;
  /** The full description for screen readers. */
  accessibilityLabel: string;
  accessibilityHint: string;
};

export function tableTileModel(table: TableView, now: number, time: (iso: string) => string): TableTileModel {
  const status = tableStatus(table);
  const tab = table.tab;
  const minutes = tab ? minutesSince(tab.opened_at, now) : 0;
  const long = tab !== null && minutes >= LONG_SEAT_MINUTES;
  const statusLabel = TABLE_STATUS_LABELS[status];
  let chip: ChipVariant = 'success';
  if (status === 'occupied') chip = long ? 'warning' : 'info';
  else if (status === 'reserved') chip = 'pending';

  const reservation = table.reservation;
  const reservedBadge = status === 'occupied' && reservation?.is_held ? `Reserved ${time(reservation.reserved_for)}` : null;

  let detail = seatsLabel(table.seats);
  let hint = 'Opens a bill for this table';
  if (tab) {
    detail = `${guestsLabel(tab.guests)}, ${formatPeso(tab.remaining_cents)}, open ${elapsedLabel(minutes)}`;
    hint = 'Opens the bill';
  } else if (status === 'reserved' && reservation) {
    detail = reservedForLabel(reservation.guest_name, reservation.party_size, time(reservation.reserved_for));
    hint = 'Shows the reservation: seat, cancel or no-show';
  }
  const extra = reservedBadge ? `, ${reservedBadge}` : '';

  return {
    status,
    long,
    minutes,
    statusLabel,
    chip,
    reservedBadge,
    accessibilityLabel: `Table ${table.name}, ${statusLabel}, ${detail}${extra}`,
    accessibilityHint: hint,
  };
}
