import { useMemo } from 'react';

import { discountNeedsApproval, discountTooLargeMessage } from '@pos/core/sale/discountRules';
import { priceCart } from '@pos/core/sale/order';
import { SC_PWD_CONFLICT_MESSAGE, TICK_ITEMS_MESSAGE } from '@pos/core/sale/scPwd';
import { parseTableNo } from '@pos/core/sale/table';
import { useCartStoreApi } from '@/stores/cart';
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
  const user = useSessionStore((state) => state.user);
  const useCartStore = useCartStoreApi();
  const lines = useCartStore((state) => state.lines);
  const orderDiscount = useCartStore((state) => state.orderDiscount);
  const customer = useCartStore((state) => state.customer);
  const serverLineErrors = useCartStore((state) => state.lineErrors);
  const serverOrderDiscountError = useCartStore((state) => state.orderDiscountError);
  const customerError = useCartStore((state) => state.customerError);
  const tableNo = useCartStore((state) => state.tableNo);
  const serverTableError = useCartStore((state) => state.tableError);
  const serverCartError = useCartStore((state) => state.cartError);
  const awaitingConfirmation = useCartStore((state) => state.awaitingConfirmation);
  const scPwd = useCartStore((state) => state.scPwd);
  const scPwdErrors = useCartStore((state) => state.scPwdErrors);

  const pricing = useMemo(() => priceCart(lines, orderDiscount, scPwd), [lines, orderDiscount, scPwd]);

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
    pricing,
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
