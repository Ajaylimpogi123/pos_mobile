import { useMemo } from 'react';

import { discountNeedsApproval, discountTooLargeMessage } from '@pos/core/sale/discountRules';
import { priceCart } from '@pos/core/sale/order';
import { SC_PWD_CONFLICT_MESSAGE, TICK_ITEMS_MESSAGE } from '@pos/core/sale/scPwd';
import { parseTableNo } from '@pos/core/sale/table';
import { priceTabSettlement } from '@pos/core/sale/tab';
import type { SalePricing } from '@pos/core/sale/pricing';
import { settleLinesOf } from '@/sale/tabLines';
import { useActiveCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';

/** Contract wording of the size limit (`422` on `items`). */
export const SALE_TOO_LARGE_MESSAGE = 'This sale is too large.';

/**
 * The cart as the screens show it: the store's lines, discounts and customer,
 * the pricing (the server's algorithm), the item count, whether the discount
 * will need a manager's approval, and every message to show: the server's
 * (kept per line after a rejected checkout; informative, since the server
 * checks again on the next attempt) and the pricing rules the cart breaks
 * right now (e.g. an amount discount above a line's new gross), which block
 * checkout until fixed.
 */
export function useCart() {
  const useStore = useActiveCartStore();
  const user = useSessionStore((state) => state.user);
  const lines = useStore((state) => state.lines);
  const orderDiscount = useStore((state) => state.orderDiscount);
  const customer = useStore((state) => state.customer);
  const serverLineErrors = useStore((state) => state.lineErrors);
  const serverOrderDiscountError = useStore((state) => state.orderDiscountError);
  const customerError = useStore((state) => state.customerError);
  const tableNo = useStore((state) => state.tableNo);
  const serverTableError = useStore((state) => state.tableError);
  const serverCartError = useStore((state) => state.cartError);
  const awaitingConfirmation = useStore((state) => state.awaitingConfirmation);
  const scPwd = useStore((state) => state.scPwd);
  const scPwdErrors = useStore((state) => state.scPwdErrors);
  const serviceCharge = useStore((state) => state.serviceCharge);
  const splitCount = useStore((state) => state.splitCount);

  // Dine-in settlement (§E): the snapshots through the same algorithm, then the service charge on top.
  const { pricing, serviceChargeCents, saleTotalCents } = useMemo((): { pricing: SalePricing; serviceChargeCents: number; saleTotalCents: number } => {
    if (!serviceCharge) {
      const sale = priceCart(lines, orderDiscount, scPwd);
      return { pricing: sale, serviceChargeCents: 0, saleTotalCents: sale.total_cents };
    }
    const settled = priceTabSettlement(settleLinesOf(lines), orderDiscount, scPwd, {
      serviceChargeBps: serviceCharge.bps,
      serviceCharge: serviceCharge.on,
    });
    return { pricing: settled, serviceChargeCents: settled.service_charge_cents, saleTotalCents: settled.sale_total_cents };
  }, [lines, orderDiscount, scPwd, serviceCharge]);

  // Senior Citizen / PWD Discount: a rule the cart breaks right now (the server would answer 422).
  let scPwdProblem: string | null = null;
  if (scPwd && pricing.scPwdInvalid && lines.length > 0) {
    const noneMarked = scPwd.mode === 'items' && !lines.some((line) => line.scPwd);
    scPwdProblem = noneMarked ? TICK_ITEMS_MESSAGE : SC_PWD_CONFLICT_MESSAGE;
  }
  const scPwdServerError = Object.values(scPwdErrors)[0] ?? null;

  const lineErrors = useMemo(() => {
    const errors: Record<string, string> = { ...serverLineErrors };
    lines.forEach((line, index) => {
      const priced = pricing.lines[index];
      if (priced?.discountExceedsGross && !errors[line.key]) errors[line.key] = discountTooLargeMessage(priced.gross_cents);
    });
    return errors;
  }, [lines, pricing, serverLineErrors]);

  const orderDiscountError =
    serverOrderDiscountError ??
    (pricing.orderDiscountExceedsBase ? discountTooLargeMessage(pricing.discount_base_cents) : null);
  const cartError = serverCartError ?? (pricing.tooLarge ? SALE_TOO_LARGE_MESSAGE : null);
  /** The SC/PWD message the cart shows (its rule first, then the server's first `sc_pwd` message). */
  const scPwdError = scPwdProblem ?? scPwdServerError;
  const table = parseTableNo(tableNo);

  return {
    lines,
    orderDiscount,
    customer,
    /** Senior Citizen / PWD Discount: the sale's SC/PWD, or `null`. */
    scPwd,
    /** The server's `sc_pwd` messages by field path (shown on the SC/PWD sheet). */
    scPwdErrors,
    scPwdError,
    /** `total_cents` includes the service charge on a dine-in settlement. */
    pricing,
    /** Dine-in settlement: the service charge setting and toggle (`null` otherwise), `S`, and `T` (before `S`). */
    serviceCharge,
    serviceChargeCents,
    saleTotalCents,
    /** Dine-in settlement (T2): the equal split, or `null`. */
    splitCount,
    /** Σ qty. */
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    isEmpty: lines.length === 0,
    needsApproval: discountNeedsApproval(pricing, user),
    lineErrors,
    orderDiscountError,
    customerError,
    /** The table number as typed, and the rule it breaks (client check first, then the server's `422`). */
    tableNo,
    tableError: table.error ?? serverTableError,
    cartError,
    awaitingConfirmation,
    /** A server message is showing on the cart (the cart bar flags it). */
    hasServerMessages:
      Object.keys(serverLineErrors).length > 0 ||
      serverOrderDiscountError !== null ||
      customerError !== null ||
      serverTableError !== null ||
      scPwdServerError !== null ||
      serverCartError !== null,
    /** A pricing rule is broken (a discount above its base, the size limit), or the table number is invalid: fix it before checkout. */
    hasProblems: !pricing.valid || table.error !== null,
    /** The line marks only count in SC/PWD `items` mode. */
    itemsMode: scPwd?.mode === 'items',
  };
}

export type CartView = ReturnType<typeof useCart>;
