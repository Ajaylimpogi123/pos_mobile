/**
 * Checkout on the web terminal (Core Sale → App; Web POS §F), ported from the
 * tablet's `useCheckout` without the offline fallback (the web terminal is
 * online only: a failed request keeps the cart and shows the error).
 *
 * - Payments: cash (Exact, ₱100, ₱500, ₱1,000), GCash with its reference,
 *   split tender, and the live amount due or change.
 * - The pending sale ULID (made when checkout opens) is both `ulid` and
 *   `Idempotency-Key`, and kept until a 201.
 * - A network error or timeout locks the cart and payments ("We couldn't
 *   confirm the sale. Retry."): Retry resends the same body and ULID.
 * - `409` in flight: retried shortly. `409` "already used": the sale exists,
 *   so `GET /orders/{ulid}` shows it (Q-004).
 * - `422`s: line / discount / customer / table / SC/PWD messages go back to the
 *   cart; the checksum message reloads the menu and re-prices the cart; the
 *   approval messages drive the approver picker and PIN; the closed-shift
 *   message sends the cashier back to "Open shift" (the cart is kept).
 * - Printing: right after a success, the receipt and tickets are queued
 *   (`POST /print-jobs`); printing never blocks or reverses a sale.
 * - Dine-in settlement (v1.26 §D.6/§E, `settlement` set; the active cart is
 *   the settlement cart): the total includes the service charge, the body is
 *   `POST /tabs/{ulid}/settle`'s (same ULID rules), an equal split takes one
 *   payment per share (`split`), and a `409` ("This bill changed on another
 *   device…") goes to `onConflict` (a dialog that reloads the tab).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { forgetClosedShift } from '@/hooks/useCurrentShift';
import { fetchAllProducts, menuKeys } from '@/hooks/useMenu';
import { stockKey } from '@/hooks/useStockBadges';
import { useCursorList } from '@/hooks/useCursorList';
import { useCart } from '@/hooks/sell/useCart';
import { discountNeedsApproval, eligibleApprovers } from '@pos/core/sale/discountRules';
import { buildOrderRequest, priceCart } from '@pos/core/sale/order';
import { ALREADY_RECORDED_MESSAGE, classifyOrderError, EARLIER_ATTEMPT_NOTE, type OrderFailure } from '@/sale/orderErrors';
import { exactCashCents, PAYMENT_LIMITS, summarizeDraft, validateTender, type GcashDraft, type TenderDraft, type TenderErrors } from '@pos/core/sale/payments';
import { parseTableNo } from '@pos/core/sale/table';
import { isApiError } from '@/services/api';
import { listPinUsers } from '@/services/auth';
import { createOrder, getOrder } from '@/services/orders';
import { settleTab } from '@/services/tabs';
import type { DiscountAuthorization, Order, OrderPaymentRequest, PinUser, Tab } from '@/services/types';
import { buildTabSettleRequest, priceTabSettlement } from '@pos/core/sale/tab';
import { equalSplitShares } from '@pos/core/sale/serviceCharge';
import { settleLinesOf } from '@/sale/tabLines';
import { cartProductFrom, useActiveCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { centsToInputText } from '@pos/core/money';

/** Checkout without an open shift (the tablet's wording, "tablet" → "terminal"). */
export const NO_SHIFT_MESSAGE = 'Open a shift on the POS screen before charging.';

export const IN_FLIGHT_RETRY_MS = 1500;
export const IN_FLIGHT_MAX_RETRIES = 3;

export type CheckoutBanner = {
  message: string;
  variant: 'error' | 'warning' | 'info';
  /** `resubmit` resends the unconfirmed sale; `lookup` repeats the Q-004 lookup. */
  retry: false | 'resubmit' | 'lookup';
};

export type ApprovalState = {
  visible: boolean;
  step: 'pick' | 'pin';
  approver: PinUser | null;
  pin: string;
  error: string | null;
  /** Why approval is asked for (the server's message, when it asked). */
  reason: string | null;
};

const CLOSED_APPROVAL: ApprovalState = { visible: false, step: 'pick', approver: null, pin: '', error: null, reason: null };

/** Contract: a PIN is 4–6 digits. */
export function isPinComplete(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

let nextGcashNumber = 1;

type CheckoutOptions = {
  /** The terminal's open shift (`null`: none). */
  shiftUlid: string | null;
  /** The sale was created: show the success view and print. */
  onCompleted: (order: Order, note: string | null) => void;
  /** A `422` sent the cashier back to the cart (close the checkout dialog). */
  onBackToCart: () => void;
  /** Dine-in: this checkout settles a tab (the active cart is the settlement cart). */
  settlement?: SettlementOptions;
};

export type SettlementOptions = {
  tabUlid: string;
  /** The `201`'s tab (`null` after the Q-004 lookup: reload it). */
  onSettledTab: (tab: Tab | null) => void;
  /** A `409` on the tab ("This bill changed on another device. Review it again."). */
  onConflict: (message: string) => void;
};

/** One share of an equal split as typed (T2 §E): cash tendered (≥ the share) or GCash (= the share) with its reference. */
export type ShareDraft = { method: 'cash' | 'gcash'; cash: string; reference: string };

const EMPTY_SHARE: ShareDraft = { method: 'cash', cash: '', reference: '' };

const SHARE_MISSING_MESSAGE = "Enter this share's payment.";

/** A share's payment, or why it can't be sent yet. */
export function shareTender(shareCents: number, draft: ShareDraft, index: number) {
  const key = `share-${index + 1}`;
  const tender: TenderDraft =
    draft.method === 'cash'
      ? { cash: draft.cash, gcash: [] }
      : { cash: '', gcash: [{ key, amount: centsToInputText(shareCents), reference: draft.reference }] };
  const result = validateTender(shareCents, tender);
  const rowErrors = result.errors?.gcash[key];
  const error = result.errors ? (result.errors.cash ?? rowErrors?.reference ?? rowErrors?.amount ?? result.errors.general ?? null) : null;
  const payment: OrderPaymentRequest | null = result.payments ? (result.payments[0] ?? null) : null;
  return { payment, error, summary: result.summary };
}

export function useCheckout({ shiftUlid, onCompleted, onBackToCart, settlement }: CheckoutOptions) {
  const useStore = useActiveCartStore();
  const cart = useCart();
  const user = useSessionStore((state) => state.user);
  const draft = useStore((state) => state.tender);
  const queryClient = useQueryClient();

  const [tenderErrors, setTenderErrors] = useState<TenderErrors | null>(null);
  const [banner, setBanner] = useState<CheckoutBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [approval, setApproval] = useState<ApprovalState>(CLOSED_APPROVAL);

  const inFlight = useRef(false);
  const lastAuthorization = useRef<DiscountAuthorization | null>(null);
  const inFlightRetries = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const lastShiftUlid = useRef<string | null>(null);
  const alreadyUsedMessage = useRef('');

  useEffect(
    () => () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    },
    [],
  );

  const pinUsers = useCursorList(['auth', 'pin-users'], (cursor) => listPinUsers({ cursor, per_page: 100 }), {
    enabled: approval.visible,
  });
  const approvers = eligibleApprovers(pinUsers.items, cart.pricing);
  const summary = summarizeDraft(cart.pricing.total_cents, draft);
  const locked = cart.awaitingConfirmation || submitting;

  // T2 §E: one payment step per share.
  const splitCount = settlement ? cart.splitCount : null;
  const [shareDrafts, setShareDrafts] = useState<ShareDraft[]>([]);
  const [shareIndex, setShareIndex] = useState(0);
  const [shareErrors, setShareErrors] = useState<Record<number, string>>({});
  const shareAmounts = useMemo(
    () => (splitCount && splitCount >= 2 ? equalSplitShares(cart.pricing.total_cents, splitCount) : []),
    [splitCount, cart.pricing.total_cents],
  );
  const shares = shareAmounts.map((amount, index) => {
    const typed = shareDrafts[index] ?? EMPTY_SHARE;
    return { amount, draft: typed, check: shareTender(amount, typed, index) };
  });
  const sharesReady = shares.length > 0 && shares.every((share) => share.check.payment !== null);
  const currentShare = Math.min(shareIndex, Math.max(0, shares.length - 1));
  const shiftBlock = shiftUlid === null && !cart.awaitingConfirmation ? NO_SHIFT_MESSAGE : null;

  function editDraft(next: (current: TenderDraft) => TenderDraft) {
    if (locked) return;
    const store = useStore.getState();
    store.setTender(next(store.tender));
    setTenderErrors(null);
  }

  function invalidateAfterSale() {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    // The advisory stock badges follow each sale (Q-036).
    void queryClient.invalidateQueries({ queryKey: stockKey });
  }

  /** After the checksum 422: reload the menu, re-price the cart from it, and show the server's message. */
  async function repriceFromMenu(message: string) {
    setRepricing(true);
    setBanner({ message, variant: 'warning', retry: false });
    try {
      const products = await queryClient.fetchQuery({ queryKey: menuKeys.products, queryFn: fetchAllProducts, staleTime: 0 });
      void queryClient.invalidateQueries({ queryKey: menuKeys.categories });
      useStore.getState().repriceProducts(products.map(cartProductFrom));
    } catch {
      // The cart keeps its prices; the next attempt tells again.
    } finally {
      setRepricing(false);
    }
  }

  function complete(order: Order, note: string | null, tab: Tab | null = null) {
    inFlightRetries.current = 0;
    setShareDrafts([]);
    setShareIndex(0);
    setShareErrors({});
    lastAuthorization.current = null;
    setApproval(CLOSED_APPROVAL);
    setBanner(null);
    useStore.getState().completeSale();
    invalidateAfterSale();
    settlement?.onSettledTab(tab);
    onCompleted(order, note);
  }

  /** Q-004: `GET /orders/{ulid}` with the pending ULID. */
  async function lookUpEarlierSale() {
    const pending = useStore.getState().pendingUlid;
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    try {
      const order = await getOrder(pending);
      complete(order, EARLIER_ATTEMPT_NOTE);
    } catch (error) {
      if (isApiError(error) && (error.status === 404 || error.status === 403)) {
        setBanner({ message: ALREADY_RECORDED_MESSAGE, variant: 'error', retry: false });
      } else {
        setBanner({ message: alreadyUsedMessage.current, variant: 'warning', retry: 'lookup' });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleFailure(failure: OrderFailure, authorization: DiscountAuthorization | null) {
    const store = useStore.getState();

    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      lastAuthorization.current = authorization;
      store.setAwaitingConfirmation(true);
      setApproval(CLOSED_APPROVAL);
      if (failure.kind === 'inFlight' && inFlightRetries.current < IN_FLIGHT_MAX_RETRIES) {
        inFlightRetries.current += 1;
        setBanner({ message: failure.message, variant: 'info', retry: false });
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          void submit(authorization);
        }, IN_FLIGHT_RETRY_MS);
      } else {
        setBanner({ message: failure.message, variant: 'warning', retry: 'resubmit' });
      }
      return;
    }

    if (failure.kind === 'alreadyUsed') {
      inFlightRetries.current = 0;
      lastAuthorization.current = authorization;
      store.setAwaitingConfirmation(true);
      setApproval(CLOSED_APPROVAL);
      alreadyUsedMessage.current = failure.message;
      void lookUpEarlierSale();
      return;
    }

    // Any other answer is final for this attempt, and a failed request never uses up the ULID.
    inFlightRetries.current = 0;
    lastAuthorization.current = null;
    store.setAwaitingConfirmation(false);

    switch (failure.kind) {
      case 'checksum':
        setApproval(CLOSED_APPROVAL);
        // A tab is priced from its snapshots: nothing to reload from the menu.
        if (settlement) setBanner({ message: failure.message, variant: 'warning', retry: false });
        else void repriceFromMenu(failure.message);
        return;
      case 'approvalRequired':
        setApproval({ ...CLOSED_APPROVAL, visible: true, reason: failure.message });
        return;
      case 'approverRejected':
        setApproval((current) => ({ ...current, visible: true, step: 'pick', approver: null, pin: '', error: failure.message }));
        return;
      case 'wrongPin':
        setApproval((current) => ({ ...current, visible: true, step: 'pin', pin: '', error: failure.message }));
        return;
      case 'pinLocked':
        if (authorization) setApproval((current) => ({ ...current, visible: true, pin: '', error: failure.message }));
        else setBanner({ message: failure.message, variant: 'error', retry: false });
        return;
      case 'cart':
        setApproval(CLOSED_APPROVAL);
        store.showServerErrors(failure.errors);
        onBackToCart();
        return;
      case 'payments':
        setApproval(CLOSED_APPROVAL);
        setTenderErrors({ gcash: {}, general: failure.message });
        return;
      case 'shiftClosed':
        setApproval(CLOSED_APPROVAL);
        forgetClosedShift(queryClient, failure.message);
        onBackToCart();
        return;
      default:
        setApproval(CLOSED_APPROVAL);
        setBanner({ message: failure.message, variant: 'error', retry: false });
    }
  }

  async function submit(authorization: DiscountAuthorization | null = null) {
    if (inFlight.current) return;
    const store = useStore.getState();
    if (store.lines.length === 0) return;
    const pricing = settlement
      ? priceTabSettlement(settleLinesOf(store.lines), store.orderDiscount, store.scPwd, {
          serviceChargeBps: store.serviceCharge?.bps ?? 0,
          serviceCharge: store.serviceCharge?.on ?? true,
        })
      : priceCart(store.lines, store.orderDiscount, store.scPwd);
    if (!pricing.valid) return;
    const table = parseTableNo(settlement ? '' : store.tableNo);
    if (table.error) return;
    let payments: OrderPaymentRequest[];
    const split = settlement && store.splitCount && store.splitCount >= 2 ? store.splitCount : null;
    if (split) {
      const amounts = equalSplitShares(pricing.total_cents, split);
      const errors: Record<number, string> = {};
      payments = [];
      amounts.forEach((amount, index) => {
        const check = shareTender(amount, shareDrafts[index] ?? EMPTY_SHARE, index);
        if (check.payment) payments.push(check.payment);
        else errors[index] = check.error ?? SHARE_MISSING_MESSAGE;
      });
      const firstBad = Object.keys(errors)[0];
      if (firstBad !== undefined) {
        setShareErrors(errors);
        setShareIndex(Number(firstBad));
        return;
      }
      setShareErrors({});
    } else {
      const tender = validateTender(pricing.total_cents, store.tender);
      if (!tender.payments) {
        setTenderErrors(tender.errors);
        return;
      }
      payments = tender.payments;
    }
    setTenderErrors(null);

    const cashier = useSessionStore.getState().user;
    const needsApproval = discountNeedsApproval(pricing, cashier);
    // A retry of an unconfirmed sale keeps its shift (the same body).
    const shift = (store.awaitingConfirmation ? lastShiftUlid.current : null) ?? shiftUlid;
    if (!shift) {
      setBanner({ message: NO_SHIFT_MESSAGE, variant: 'warning', retry: false });
      return;
    }
    lastShiftUlid.current = shift;

    if (!authorization && needsApproval) {
      setApproval({ ...CLOSED_APPROVAL, visible: true });
      return;
    }

    const ulid = store.beginCheckout();
    if (settlement) {
      await submitSettlement(settlement, {
        ulid,
        shiftUlid: shift,
        lines: settleLinesOf(store.lines),
        customer: store.customer,
        orderDiscount: store.orderDiscount,
        scPwd: store.scPwd,
        serviceCharge: store.serviceCharge?.on ?? true,
        splitCount: split,
        payments,
        clientTotalCents: pricing.total_cents,
        authorization,
      });
      return;
    }
    const body = buildOrderRequest({
      ulid,
      lines: store.lines,
      orderDiscount: store.orderDiscount,
      customer: store.customer,
      tableNo: table.value,
      payments,
      clientTotalCents: pricing.total_cents,
      authorization,
      shiftUlid: shift,
      scPwd: store.scPwd,
    });

    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    store.clearServerErrors();
    let failure: OrderFailure | null = null;
    try {
      const order = await createOrder(body);
      complete(order, null);
    } catch (error) {
      failure = classifyOrderError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (failure) handleFailure(failure, authorization);
  }

  /** `POST /tabs/{ulid}/settle`: the same failure handling as a sale, plus the tab's `409` dialog. */
  async function submitSettlement(options: SettlementOptions, input: Parameters<typeof buildTabSettleRequest>[0]) {
    const store = useStore.getState();
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    store.clearServerErrors();
    let failure: OrderFailure | null = null;
    try {
      const response = await settleTab(options.tabUlid, buildTabSettleRequest(input));
      complete(response.data, null, response.tab);
    } catch (error) {
      failure = classifyOrderError(error);
      // §I: a 409 on the tab shows in a dialog that reloads it (the idempotency 409s keep their handling).
      if (failure.kind === 'other' && isApiError(error) && error.status === 409) {
        setApproval(CLOSED_APPROVAL);
        options.onConflict(failure.message);
        failure = null;
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (failure) handleFailure(failure, input.authorization);
  }

  function editShare(index: number, changes: Partial<ShareDraft>) {
    if (locked) return;
    setShareDrafts((current) => {
      const next = shareAmounts.map((_amount, at) => current[at] ?? EMPTY_SHARE);
      next[index] = { ...next[index], ...changes };
      return next;
    });
    setShareErrors((current) => {
      if (!(index in current)) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function addGcash() {
    editDraft((current) => {
      if (current.gcash.length >= PAYMENT_LIMITS.maxPayments - 1) return current;
      const due = summarizeDraft(cart.pricing.total_cents, current).dueCents;
      const row: GcashDraft = { key: `gcash-${nextGcashNumber}`, amount: due > 0 ? centsToInputText(due) : '', reference: '' };
      nextGcashNumber += 1;
      return { ...current, gcash: [...current.gcash, row] };
    });
  }

  return {
    cart,
    user,
    draft,
    summary,
    tenderErrors,
    banner,
    submitting,
    repricing,
    locked,
    shiftBlock,
    canAddGcash: !locked && draft.gcash.length < PAYMENT_LIMITS.maxPayments - 1,
    canConfirm:
      shiftBlock === null &&
      !cart.isEmpty &&
      !cart.hasProblems &&
      !submitting &&
      !repricing &&
      (cart.awaitingConfirmation || (splitCount ? sharesReady : !summary.short && !summary.gcashOverTotal)),
    /** T2 §E: the equal split's shares (`null`: a single payment screen). */
    split: splitCount
      ? {
          count: splitCount,
          shares,
          current: currentShare,
          errors: shareErrors,
          ready: sharesReady,
          goTo: (index: number) => setShareIndex(Math.max(0, Math.min(index, shares.length - 1))),
          /** The next share, once this one is valid. */
          next: () => {
            const share = shares[currentShare];
            if (!share) return;
            if (!share.check.payment) {
              setShareErrors((current) => ({ ...current, [currentShare]: share.check.error ?? SHARE_MISSING_MESSAGE }));
              return;
            }
            setShareIndex(Math.min(currentShare + 1, shares.length - 1));
          },
          setMethod: (index: number, method: ShareDraft['method']) => editShare(index, { method }),
          setCash: (index: number, cash: string) => editShare(index, { cash }),
          setExact: (index: number) => editShare(index, { cash: centsToInputText(shares[index]?.amount ?? 0) }),
          setQuickCash: (index: number, cents: number) => editShare(index, { cash: centsToInputText(cents) }),
          setReference: (index: number, reference: string) => editShare(index, { reference }),
        }
      : null,
    retryLookup: () => void lookUpEarlierSale(),
    /** Dine-in settlement: the service-charge toggle (`service_charge` in the body). */
    setServiceChargeOn: (on: boolean) => {
      if (locked) return;
      useStore.getState().setServiceChargeOn(on);
    },
    setCash: (text: string) => editDraft((current) => ({ ...current, cash: text })),
    setQuickCash: (cents: number) => editDraft((current) => ({ ...current, cash: cents > 0 ? centsToInputText(cents) : '' })),
    setExactCash: () =>
      editDraft((current) => {
        const exact = exactCashCents(cart.pricing.total_cents, current);
        return { ...current, cash: exact > 0 ? centsToInputText(exact) : '' };
      }),
    addGcash,
    updateGcash: (key: string, changes: Partial<Pick<GcashDraft, 'amount' | 'reference'>>) =>
      editDraft((current) => ({
        ...current,
        gcash: current.gcash.map((row) => (row.key === key ? { ...row, ...changes } : row)),
      })),
    removeGcash: (key: string) => editDraft((current) => ({ ...current, gcash: current.gcash.filter((row) => row.key !== key) })),
    /** Confirm (or Retry the unconfirmed attempt, with the same ULID and approval). */
    confirm: () => void submit(cart.awaitingConfirmation ? lastAuthorization.current : null),
    dismissBanner: () => setBanner(null),
    approval,
    approvers,
    approversLoading: pinUsers.loading,
    approversError: pinUsers.error,
    retryApprovers: pinUsers.retry,
    chooseApprover: (person: PinUser) => setApproval((current) => ({ ...current, step: 'pin', approver: person, pin: '', error: null })),
    backToApprovers: () => setApproval((current) => ({ ...current, step: 'pick', approver: null, pin: '', error: null })),
    setApprovalPin: (pin: string) => setApproval((current) => ({ ...current, pin: pin.replace(/\D/g, '').slice(0, 6), error: null })),
    approve: () => {
      if (!approval.approver || !isPinComplete(approval.pin)) return;
      void submit({ user_id: approval.approver.id, pin: approval.pin });
    },
    cancelApproval: () => {
      if (!submitting) setApproval(CLOSED_APPROVAL);
    },
  };
}

export type CheckoutState = ReturnType<typeof useCheckout>;
