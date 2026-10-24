/**
 * Voids & Refunds (docs/api-contract.md → Voids & Refunds (Phase 7) → Device
 * rules): where the actions show, when they are enabled, and the words staff
 * see. Pure functions: the screens feed them the live state.
 *
 * - **Void sale:** shown when `status = completed` and the order's
 *   `shift_ulid` is **this tablet's open shift**; disabled offline.
 * - **Refund:** shown when `status` is `completed` or `partially_refunded`;
 *   it needs an open shift on this tablet and a connection.
 * - Offline, both say `Voids and refunds need a connection.` A local order
 *   that hasn't synced says `This sale hasn't synced yet.` and offers no action.
 * - Starting either needs `sale.create`, or `sale.void` / `sale.refund`
 *   (a UI hint: the server enforces).
 */
import type { Order, OrderStatus, PaymentMethod, PrintableOrder } from '@/services/types';
import { formatPeso } from '@/utils/money';

import { paidByMethod } from './refunds';

/** Contract: offline, both actions say this. */
export const REVERSAL_OFFLINE_MESSAGE = 'Voids and refunds need a connection.';

/** Contract: a local order that hasn't synced offers no action. */
export const REVERSAL_UNSYNCED_MESSAGE = "This sale hasn't synced yet.";

/**
 * A refund needs an open shift on this tablet (the cash comes out of its drawer).
 * Wording agreed in Q-017.
 */
export const REFUND_NO_SHIFT_MESSAGE = 'Open a shift on the Sell screen to refund this sale.';

/** Contract: the void dialog's quick picks (`Other…` asks for the reason). */
export const VOID_REASONS = ['Customer cancelled', 'Wrong order', 'Duplicate sale'] as const;
export const OTHER_REASON = 'Other…';

/** A network error or timeout on a void: Retry resends it with the same key. Wording agreed in Q-017. */
export const VOID_UNCONFIRMED_MESSAGE = "We couldn't confirm the void. Retry.";
/** A network error or timeout on a refund: Retry resends it with the same `ulid`. Wording agreed in Q-017. */
export const REFUND_UNCONFIRMED_MESSAGE = "We couldn't confirm the refund. Retry.";

export type ReversalAction = {
  enabled: boolean;
  /** Why it is disabled (shown under the buttons), or `null`. */
  message: string | null;
};

export type ReversalGate = {
  /** Shown instead of the actions (e.g. an unsynced local sale), or `null`. */
  notice: string | null;
  /** `null`: Void sale isn't shown. */
  void: ReversalAction | null;
  /** `null`: Refund isn't shown. */
  refund: ReversalAction | null;
};

export type ReversalGateInput = {
  order: Pick<PrintableOrder, 'status' | 'shift_ulid'>;
  /** A local sale that hasn't synced (pending or needs attention). */
  unsynced: boolean;
  /** The device is connected and the server answered the last request. */
  online: boolean;
  /** This tablet's open shift, or `null`. */
  currentShiftUlid: string | null;
  /** Still reading the tablet's shift. */
  shiftLoading: boolean;
  /** `sale.create` or `sale.void`. */
  canVoid: boolean;
  /** `sale.create` or `sale.refund`. */
  canRefund: boolean;
};

const NONE: ReversalGate = { notice: null, void: null, refund: null };

/** Which actions the order detail shows, and whether they can run now (see the module notes). */
export function reversalGate(input: ReversalGateInput): ReversalGate {
  const { order } = input;
  if (!input.canVoid && !input.canRefund) return NONE;
  if (input.unsynced) return { notice: REVERSAL_UNSYNCED_MESSAGE, void: null, refund: null };

  let voidAction: ReversalAction | null = null;
  if (input.canVoid && order.status === 'completed' && order.shift_ulid !== null && order.shift_ulid === input.currentShiftUlid) {
    voidAction = input.online ? { enabled: true, message: null } : { enabled: false, message: REVERSAL_OFFLINE_MESSAGE };
  }

  let refundAction: ReversalAction | null = null;
  if (input.canRefund && (order.status === 'completed' || order.status === 'partially_refunded')) {
    if (!input.online) refundAction = { enabled: false, message: REVERSAL_OFFLINE_MESSAGE };
    else if (input.shiftLoading) refundAction = { enabled: false, message: null };
    else if (input.currentShiftUlid === null) refundAction = { enabled: false, message: REFUND_NO_SHIFT_MESSAGE };
    else refundAction = { enabled: true, message: null };
  }

  return { notice: null, void: voidAction, refund: refundAction };
}

/** The money to hand back, per method. */
export type GiveBack = Record<PaymentMethod, number>;

/**
 * "Sale voided. Give back ₱157.00 cash" and "Send back ₱100.00 GCash" (each
 * line only when that method has an amount). `headline` is "Sale voided." or
 * "Refund done." when nothing is owed back.
 */
export function giveBackLines(headline: 'Sale voided.' | 'Refund done.', amounts: GiveBack): string[] {
  const lines: string[] = [];
  if (amounts.cash > 0) lines.push(`${headline} Give back ${formatPeso(amounts.cash)} cash`);
  if (amounts.gcash > 0) lines.push(lines.length === 0 ? `${headline} Send back ${formatPeso(amounts.gcash)} GCash` : `Send back ${formatPeso(amounts.gcash)} GCash`);
  return lines.length > 0 ? lines : [headline];
}

/** A void gives back what the sale was paid, per method (the server `Order`'s payments). */
export function voidGiveBack(order: Pick<Order, 'payments'>): GiveBack {
  return paidByMethod(order);
}

/** On-screen labels of the order statuses. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  completed: 'Completed',
  voided: 'Voided',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
};

/** "Voided", "Partly refunded", … (a status this build doesn't know shows as it is). */
export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

/** The Status filter's choices, in the order the picker lists them. */
export const ORDER_STATUS_FILTERS: readonly OrderStatus[] = ['completed', 'voided', 'refunded', 'partially_refunded'];
