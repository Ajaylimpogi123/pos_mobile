/**
 * The X-read / Z-read document (`@pos/core/printing/documents/shiftRead`)
 * of a **server** `Shift`: on the web terminal the server's `report` is the
 * only report (online only), so every figure comes from it.
 */
import type { Shift } from '@/services/types';
import type { ShiftReadDocument, ShiftReadKind } from '@pos/core/printing/documents/shiftRead';

export function shiftReadDocument(shift: Shift, kind: ShiftReadKind, branchName: string | null, printedAt: string): ShiftReadDocument {
  return {
    kind,
    shift: {
      ulid: shift.ulid,
      deviceCode: shift.device.code,
      openedAt: shift.opened_at,
      openedBy: shift.opened_by,
      openingFloatCents: shift.opening_float_cents,
      closedAt: shift.closed_at,
      closedBy: shift.closed_by,
      countedCashCents: shift.counted_cash_cents,
      closeNote: shift.close_note,
    },
    report: shift.report,
    printedAt,
    branchName,
  };
}
