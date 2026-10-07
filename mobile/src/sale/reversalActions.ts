/**
 * What the tablet records after a void or a refund the server confirmed
 * (docs/api-contract.md → Voids & Refunds (Phase 7) → Device rules):
 *
 * - After a void's `200`: the stored copy of the sale gets the server's
 *   voided `Order`, so the tablet's shift report counts it as a void.
 * - After a refund's `201`: the stored copy gets the new `Order`, and the
 *   refund goes to `local_refunds` for the shift report.
 *
 * Only when the tablet has the sale ("when the tablet has it"). None of these
 * reject: the void or refund is done on the server whatever happens here.
 * Printing is the caller's next step (`@/printing/printActions`).
 */
import { prepareDatabase } from '@/db/database';
import { offlineRepository } from '@/db/offlineRepository';
import { refundRepository } from '@/db/refundRepository';
import { isoSeconds } from '@/sale/localOrder';
import type { Order, Refund } from '@/services/types';
import { useOfflineStore } from '@/stores/offline';

/** The refund with this ULID in the order's `refunds`, or `null`. */
export function findRefund(order: Pick<Order, 'refunds'>, refundUlid: string): Refund | null {
  return order.refunds.find((refund) => refund.ulid === refundUlid) ?? null;
}

/** After a void's `200`. Never rejects. */
export async function recordVoidOnTablet(order: Order, now: number): Promise<void> {
  try {
    if (!(await prepareDatabase())) return;
    if (await offlineRepository.replaceServerOrder(order, isoSeconds(now))) useOfflineStore.getState().markLocalChanged();
  } catch {
    // The tablet's report misses the void until the next read; the server's report has it.
  }
}

/** After a refund's `201`: returns the new refund (from the returned `Order`), or `null`. Never rejects. */
export async function recordRefundOnTablet(order: Order, refundUlid: string, now: number): Promise<Refund | null> {
  const refund = findRefund(order, refundUlid);
  try {
    if (!(await prepareDatabase())) return refund;
    const at = isoSeconds(now);
    const replaced = await offlineRepository.replaceServerOrder(order, at);
    const stored = refund ? await refundRepository.saveRefund(order.ulid, refund, at) : false;
    if (replaced || stored) useOfflineStore.getState().markLocalChanged();
  } catch {
    // The tablet's report misses this refund; the server's report has it.
  }
  return refund;
}
