import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { orderKeys } from '@/hooks/orders/queryKeys';
import { usePinUsers } from '@/hooks/pin/usePinUsers';
import { useCart } from '@/hooks/sell/useCart';
import type { ApprovalState } from '@/hooks/sell/useCheckout';
import { useCurrentShift } from '@/hooks/shifts/useCurrentShift';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { useServiceChargeBps } from '@/hooks/tables/useDineIn';
import { useIsOnline } from '@/hooks/useIsOnline';
import { printSale } from '@/printing/printActions';
import { ALREADY_RECORDED_MESSAGE, classifyOrderError, EARLIER_ATTEMPT_NOTE } from '@/sale/orderErrors';
import { isApiError } from '@/services/api';
import { getOrder } from '@/services/orders';
import { getTab, settleTab } from '@/services/tables';
import type { DiscountAuthorization, Order, OrderPaymentRequest, PinUser, Tab, TabItem } from '@/services/types';
import type { CartLine } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import { tabItemIdOfLine, tabSettlementCart, useTabCheckoutStore, type TabPayMode } from '@/stores/tabCarts';
import { markShiftClosedByServer, NO_SHIFT_MESSAGE, storeOnlineSale } from '@/shifts/shiftActions';
import { isPinComplete } from '@/utils/pin';
import { centsToInputText } from '@pos/core/money';
import { discountNeedsApproval, eligibleApprovers } from '@pos/core/sale/discountRules';
import {
  exactCashCents,
  PAYMENT_LIMITS,
  summarizeDraft,
  validateTender,
  type GcashDraft,
  type TenderDraft,
  type TenderErrors,
} from '@pos/core/sale/payments';
import { computeServiceCharge, equalSplitShares, SPLIT_COUNT_MAX, SPLIT_COUNT_MIN } from '@pos/core/sale/serviceCharge';
import { buildTabSettleRequest, priceTabSettlement, tabRemainingLines, type TabSettleLine } from '@pos/core/sale/tab';

import { isTabConflict } from './useTab';

export const SETTLE_UNCONFIRMED_MESSAGE = "We couldn't confirm the payment. Retry: it won't be charged twice.";
export const ONE_PAYMENT_PER_SHARE_MESSAGE = 'Pay each share with one method: cash, or one GCash payment.';
export const NOTHING_SELECTED_MESSAGE = 'Choose the items to pay now.';

const IN_FLIGHT_RETRY_MS = 1500;
const IN_FLIGHT_MAX_RETRIES = 3;

const EMPTY_TENDER: TenderDraft = { cash: '', gcash: [] };
const CLOSED_APPROVAL: ApprovalState = { visible: false, step: 'pick', approver: null, pin: '', error: null, reason: null };

let nextGcashNumber = 1;

export type TabCheckoutBanner = { message: string; variant: 'error' | 'warning' | 'info'; retry: false | 'resubmit' | 'lookup' };

/** A tab item as a settlement cart line (key `tab-<id>`, the snapshot price); `previous` keeps its discount and SC/PWD mark. */
function lineOf(item: TabItem, qty: number, previous: CartLine | undefined): CartLine {
  return {
    key: `tab-${item.id}`,
    product: {
      id: item.product_id,
      category_id: item.category_id,
      name: item.product_name,
      sku: null,
      price_cents: item.unit_price_cents,
      is_vatable: item.is_vatable,
      is_available: true,
      track_stock: false,
    },
    qty,
    discount: previous?.discount ?? null,
    notes: item.notes,
    scPwd: previous?.scPwd ?? false,
  };
}

/** The settlement lines for the mode: every remaining quantity, or the chosen ones. */
function linesFor(tab: Tab, mode: TabPayMode, selected: Record<number, number>, current: readonly CartLine[]): CartLine[] {
  const byKey = new Map(current.map((line) => [line.key, line]));
  return tabRemainingLines(tab).flatMap((item) => {
    const qty = mode === 'items' ? Math.min(item.remaining_qty, selected[item.id] ?? 0) : item.remaining_qty;
    return qty > 0 ? [lineOf(item, qty, byKey.get(`tab-${item.id}`))] : [];
  });
}

function sameLines(a: readonly CartLine[], b: readonly CartLine[]): boolean {
  return a.length === b.length && a.every((line, index) => line.key === b[index].key && line.qty === b[index].qty);
}

/** The settlement's lines for the shared pricing and the body. */
function settleLinesOf(lines: readonly CartLine[]): TabSettleLine[] {
  return lines.map((line) => ({
    item: { id: tabItemIdOfLine(line.key) ?? 0, unit_price_cents: line.product.price_cents, is_vatable: line.product.is_vatable },
    qty: line.qty,
    discount: line.discount,
    scPwd: line.scPwd,
  }));
}

/**
 * **Pay** a dine-in tab (Dine-in Tables & Tabs §D.6 and §E): the whole bill,
 * **By item** (the quantities chosen now; each payment is its own order) or
 * **Equally** (2–10 shares, one payment step per share), through the
 * checkout's parts: discounts and SC/PWD on the settlement cart, the
 * service-charge toggle, cash / GCash, manager approval.
 *
 * - `POST /tabs/{ulid}/settle` with the settlement ULID (also the
 *   `Idempotency-Key`), kept until a `201`. **Online only**: a lost answer
 *   locks the payment and Retry resends the same body (settlements are never
 *   queued). A `409` "This bill changed on another device." shows in a dialog
 *   and reloads the tab.
 * - After the `201`: the success screen from the `Order`, the receipt (one per
 *   share), the sale stored for the shift report; the kitchen gets nothing
 *   (the rounds were already sent).
 */
export function useTabCheckout(ulid: string) {
  const client = useQueryClient();
  const online = useIsOnline();
  const user = useSessionStore((state) => state.user);
  const serviceChargeBps = useServiceChargeBps();
  const currentShift = useCurrentShift();
  const checkout = useTabCheckoutStore();
  const cart = useCart();
  const tender = tabSettlementCart((state) => state.tender);
  const tabQuery = useQuery({ queryKey: tableKeys.tab(ulid), queryFn: () => getTab(ulid), enabled: online && ulid !== '', refetchOnMount: 'always' });
  const tab = tabQuery.data ?? null;

  const [tenderErrors, setTenderErrors] = useState<TenderErrors | null>(null);
  const [banner, setBanner] = useState<TabCheckoutBanner | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<{ order: Order; tab: Tab; note: string | null } | null>(null);
  const [approval, setApproval] = useState<ApprovalState>(CLOSED_APPROVAL);
  const inFlight = useRef(false);
  const retries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAuthorization = useRef<DiscountAuthorization | null>(null);
  const lastShiftUlid = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // A new tab (or a fresh start): reset the choices and the settlement cart. An unconfirmed payment keeps everything.
  const started = checkout.tabUlid === ulid;
  useEffect(() => {
    if (started || tabSettlementCart.getState().awaitingConfirmation) return;
    useTabCheckoutStore.getState().start(ulid, 'whole');
    tabSettlementCart.getState().clear();
  }, [started, ulid]);

  // The settlement lines follow the tab, the mode and the chosen quantities (never while a payment is unconfirmed).
  useEffect(() => {
    if (!tab || !started) return;
    const store = tabSettlementCart.getState();
    if (store.awaitingConfirmation) return;
    const next = linesFor(tab, checkout.mode, checkout.selected, store.lines);
    if (!sameLines(next, store.lines)) {
      tabSettlementCart.setState({ lines: next, ...(next.length === 0 ? { scPwd: null } : null) });
    }
  }, [tab, started, checkout.mode, checkout.selected]);

  const pricing = useMemo(
    () =>
      priceTabSettlement(settleLinesOf(cart.lines), cart.orderDiscount, cart.scPwd, {
        serviceChargeBps,
        serviceCharge: checkout.serviceCharge,
      }),
    [cart.lines, cart.orderDiscount, cart.scPwd, serviceChargeBps, checkout.serviceCharge],
  );
  const split = checkout.mode === 'equal';
  const shareCount = split ? Math.min(SPLIT_COUNT_MAX, Math.max(SPLIT_COUNT_MIN, checkout.splitCount)) : 1;
  const shares = useMemo(() => (split ? equalSplitShares(pricing.total_cents, shareCount) : [pricing.total_cents]), [split, pricing.total_cents, shareCount]);
  const shareIndex = split ? Math.min(checkout.shareIndex, shareCount - 1) : 0;
  const dueCents = shares[shareIndex] ?? 0;
  const draft = split ? (checkout.shareTenders[shareIndex] ?? EMPTY_TENDER) : tender;
  const summary = summarizeDraft(dueCents, draft);
  const locked = cart.awaitingConfirmation || submitting;
  const needsApproval = discountNeedsApproval(pricing, user);
  const pinUsers = usePinUsers(approval.visible);
  const approvers = eligibleApprovers(pinUsers.items, pricing);
  const shiftBlock = !currentShift.loading && currentShift.shift === null ? (currentShift.error ?? NO_SHIFT_MESSAGE) : null;

  function editDraft(next: (current: TenderDraft) => TenderDraft) {
    if (locked) return;
    if (split) {
      const tenders = [...useTabCheckoutStore.getState().shareTenders];
      while (tenders.length < shareCount) tenders.push(EMPTY_TENDER);
      tenders[shareIndex] = next(tenders[shareIndex] ?? EMPTY_TENDER);
      useTabCheckoutStore.getState().set({ shareTenders: tenders });
    } else {
      tabSettlementCart.getState().setTender(next(tabSettlementCart.getState().tender));
    }
    setTenderErrors(null);
  }

  /** The payments in share order (or the one tender), checked; `null` with the errors shown. */
  function readyPayments(): OrderPaymentRequest[] | null {
    if (!split) {
      const result = validateTender(pricing.total_cents, tabSettlementCart.getState().tender);
      if (!result.payments) {
        setTenderErrors(result.errors);
        return null;
      }
      return result.payments;
    }
    const tenders = useTabCheckoutStore.getState().shareTenders;
    const payments: OrderPaymentRequest[] = [];
    for (let index = 0; index < shareCount; index += 1) {
      const result = validateTender(shares[index], tenders[index] ?? EMPTY_TENDER);
      if (!result.payments || result.payments.length !== 1) {
        useTabCheckoutStore.getState().set({ shareIndex: index });
        setTenderErrors(result.errors ?? { gcash: {}, general: ONE_PAYMENT_PER_SHARE_MESSAGE });
        return null;
      }
      payments.push(result.payments[0]);
    }
    return payments;
  }

  function succeed(order: Order, nextTab: Tab, note: string | null, shiftUlid: string | null) {
    retries.current = 0;
    lastAuthorization.current = null;
    setApproval(CLOSED_APPROVAL);
    setCompleted({ order, tab: nextTab, note });
    tabSettlementCart.getState().completeSale();
    useTabCheckoutStore.getState().reset();
    client.setQueryData(tableKeys.tab(nextTab.ulid), nextTab);
    void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
    void client.invalidateQueries({ queryKey: orderKeys.all });
    void client.invalidateQueries({ queryKey: dashboardKeys.dashboard });
    const cashier = useSessionStore.getState().user;
    if (cashier) void storeOnlineSale(order, shiftUlid ?? order.shift_ulid, cashier, Date.now());
    void printSale(order);
  }

  /** Q-004: the key was already used by a request that succeeded: read that order (and the tab). */
  async function lookUp(message: string) {
    const key = tabSettlementCart.getState().pendingUlid;
    if (!key) return;
    try {
      const [order, nextTab] = await Promise.all([getOrder(key), getTab(ulid)]);
      succeed(order, nextTab, EARLIER_ATTEMPT_NOTE, lastShiftUlid.current);
    } catch (error) {
      if (isApiError(error) && (error.status === 404 || error.status === 403)) {
        setBanner({ message: ALREADY_RECORDED_MESSAGE, variant: 'error', retry: false });
      } else {
        setBanner({ message, variant: 'warning', retry: 'lookup' });
      }
    }
  }

  async function submit(authorization: DiscountAuthorization | null = null) {
    if (inFlight.current || completed || !tab) return;
    const store = tabSettlementCart.getState();
    if (store.lines.length === 0) {
      setBanner({ message: NOTHING_SELECTED_MESSAGE, variant: 'warning', retry: false });
      return;
    }
    if (!pricing.valid) return;
    const payments = readyPayments();
    if (!payments) return;
    setTenderErrors(null);
    const shiftUlid = (store.awaitingConfirmation ? lastShiftUlid.current : null) ?? useShiftStore.getState().current?.ulid ?? null;
    if (!shiftUlid) {
      setBanner({ message: NO_SHIFT_MESSAGE, variant: 'warning', retry: false });
      return;
    }
    lastShiftUlid.current = shiftUlid;
    if (!authorization && needsApproval) {
      setApproval({ ...CLOSED_APPROVAL, visible: true });
      return;
    }

    const key = store.beginCheckout();
    const body = buildTabSettleRequest({
      ulid: key,
      shiftUlid,
      lines: settleLinesOf(store.lines),
      customer: store.customer,
      orderDiscount: store.orderDiscount,
      scPwd: store.scPwd,
      serviceCharge: useTabCheckoutStore.getState().serviceCharge,
      splitCount: split ? shareCount : null,
      payments,
      clientTotalCents: pricing.total_cents,
      authorization,
    });

    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    store.clearServerErrors();
    let failure: unknown = null;
    try {
      const result = await settleTab(ulid, body);
      succeed(result.data, result.tab, null, shiftUlid);
    } catch (error) {
      failure = error;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (failure === null) return;

    if (isTabConflict(failure)) {
      // Someone else settled or cancelled first: a new attempt (new ULID) after reviewing the bill again.
      tabSettlementCart.setState({ pendingUlid: null, awaitingConfirmation: false });
      setApproval(CLOSED_APPROVAL);
      setConflict(failure.message);
      void tabQuery.refetch();
      void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
      return;
    }
    const classified = classifyOrderError(failure);
    const cartStore = tabSettlementCart.getState();
    if (classified.kind === 'unconfirmed' || classified.kind === 'inFlight') {
      lastAuthorization.current = authorization;
      cartStore.setAwaitingConfirmation(true);
      setApproval(CLOSED_APPROVAL);
      if (classified.kind === 'inFlight' && retries.current < IN_FLIGHT_MAX_RETRIES) {
        retries.current += 1;
        setBanner({ message: classified.message, variant: 'info', retry: false });
        timer.current = setTimeout(() => {
          timer.current = null;
          if (mounted.current) void submit(authorization);
        }, IN_FLIGHT_RETRY_MS);
      } else {
        setBanner({ message: SETTLE_UNCONFIRMED_MESSAGE, variant: 'warning', retry: 'resubmit' });
      }
      return;
    }
    if (classified.kind === 'alreadyUsed') {
      lastAuthorization.current = authorization;
      cartStore.setAwaitingConfirmation(true);
      setApproval(CLOSED_APPROVAL);
      await lookUp(classified.message);
      return;
    }
    retries.current = 0;
    lastAuthorization.current = null;
    cartStore.setAwaitingConfirmation(false);
    switch (classified.kind) {
      case 'checksum':
        setApproval(CLOSED_APPROVAL);
        setBanner({ message: classified.message, variant: 'warning', retry: false });
        void tabQuery.refetch();
        return;
      case 'approvalRequired':
        setApproval({ ...CLOSED_APPROVAL, visible: true, reason: classified.message });
        return;
      case 'approverRejected':
        setApproval((current) => ({ ...current, visible: true, step: 'pick', approver: null, pin: '', error: classified.message }));
        return;
      case 'wrongPin':
        setApproval((current) => ({ ...current, visible: true, step: 'pin', pin: '', error: classified.message }));
        return;
      case 'pinLocked':
        if (authorization) setApproval((current) => ({ ...current, visible: true, pin: '', error: classified.message }));
        else setBanner({ message: classified.message, variant: 'error', retry: false });
        return;
      case 'cart':
        setApproval(CLOSED_APPROVAL);
        cartStore.showServerErrors(classified.errors);
        setBanner({ message: classified.errors.cart ?? classified.message, variant: 'error', retry: false });
        return;
      case 'payments':
        setApproval(CLOSED_APPROVAL);
        setTenderErrors({ gcash: {}, general: classified.message });
        return;
      case 'shiftClosed': {
        setApproval(CLOSED_APPROVAL);
        const branchId = useSessionStore.getState().user?.branch.id;
        if (branchId !== undefined) void markShiftClosedByServer(shiftUlid, classified.message, branchId, Date.now());
        setBanner({ message: classified.message, variant: 'warning', retry: false });
        return;
      }
      default:
        setApproval(CLOSED_APPROVAL);
        setBanner({ message: classified.message, variant: 'error', retry: false });
    }
  }

  const controls = {
    draft,
    summary,
    tenderErrors,
    locked,
    canAddGcash: !locked && !(split && (draft.gcash.length > 0 || draft.cash.trim() !== '')) && draft.gcash.length < PAYMENT_LIMITS.maxPayments - 1,
    addGcash: () =>
      editDraft((current) => {
        const due = summarizeDraft(dueCents, current).dueCents;
        const row: GcashDraft = { key: `tab-gcash-${nextGcashNumber}`, amount: due > 0 ? centsToInputText(due) : '', reference: '' };
        nextGcashNumber += 1;
        return { ...current, gcash: [...current.gcash, row] };
      }),
    setCash: (text: string) => editDraft((current) => ({ ...current, cash: text })),
    setQuickCash: (cents: number) => editDraft((current) => ({ ...current, cash: cents > 0 ? centsToInputText(cents) : '' })),
    setExactCash: () =>
      editDraft((current) => {
        const exact = exactCashCents(dueCents, current);
        return { ...current, cash: exact > 0 ? centsToInputText(exact) : '' };
      }),
    updateGcash: (key: string, changes: Partial<Pick<GcashDraft, 'amount' | 'reference'>>) =>
      editDraft((current) => ({ ...current, gcash: current.gcash.map((row) => (row.key === key ? { ...row, ...changes } : row)) })),
    removeGcash: (key: string) => editDraft((current) => ({ ...current, gcash: current.gcash.filter((row) => row.key !== key) })),
    cart: { pricing: { total_cents: dueCents } },
  };

  const shareReady = (index: number) => {
    const result = validateTender(shares[index] ?? 0, checkout.shareTenders[index] ?? EMPTY_TENDER);
    return result.payments !== null && result.payments.length === 1;
  };
  const lastShare = !split || shareIndex === shareCount - 1;

  return {
    online,
    tab,
    tabLoading: tabQuery.isPending && online,
    tabError: tabQuery.error,
    refetchTab: () => void tabQuery.refetch(),
    cart,
    pricing,
    serviceChargeBps,
    serviceChargeCents: pricing.service_charge_cents,
    /** The service charge if it were on (for the toggle's label). */
    serviceChargeIfOn: serviceChargeBps > 0 ? computeServiceCharge(pricing.sale_total_cents, serviceChargeBps) : 0,
    mode: checkout.mode,
    setMode: (mode: TabPayMode) => {
      if (locked) return;
      useTabCheckoutStore.getState().set({ mode, shareIndex: 0 });
      setTenderErrors(null);
    },
    selected: checkout.selected,
    setSelected: (itemId: number, qty: number) => {
      if (locked) return;
      useTabCheckoutStore.getState().set({ selected: { ...useTabCheckoutStore.getState().selected, [itemId]: qty } });
    },
    serviceCharge: checkout.serviceCharge,
    setServiceCharge: (on: boolean) => {
      if (!locked) useTabCheckoutStore.getState().set({ serviceCharge: on });
    },
    split,
    shareCount,
    setShareCount: (count: number) => {
      if (!locked) useTabCheckoutStore.getState().set({ splitCount: count, shareIndex: 0, shareTenders: [] });
    },
    shares,
    shareIndex,
    shareReady,
    goToShare: (index: number) => {
      if (submitting) return;
      if (index > shareIndex && !shareReady(shareIndex)) {
        readyPayments();
        return;
      }
      useTabCheckoutStore.getState().set({ shareIndex: Math.max(0, Math.min(shareCount - 1, index)) });
      setTenderErrors(null);
    },
    lastShare,
    dueCents,
    controls,
    banner,
    conflict,
    dismissConflict: () => setConflict(null),
    submitting,
    completed,
    shiftBlock,
    needsApproval,
    canConfirm:
      online &&
      shiftBlock === null &&
      !currentShift.loading &&
      !cart.isEmpty &&
      pricing.valid &&
      !submitting &&
      (cart.awaitingConfirmation || (!summary.short && !summary.gcashOverTotal)),
    confirm: () => void submit(cart.awaitingConfirmation ? lastAuthorization.current : null),
    retryLookup: () => void lookUp(banner?.message ?? ''),
    // Manager approval (the same flow as the pay-now checkout).
    approval,
    approvers,
    approversLoading: pinUsers.grid.loading,
    approversError: pinUsers.grid.error,
    retryApprovers: pinUsers.grid.onRetry,
    chooseApprover: (person: PinUser) => setApproval((current) => ({ ...current, step: 'pin', approver: person, pin: '', error: null })),
    backToApprovers: () => setApproval((current) => ({ ...current, step: 'pick', approver: null, pin: '', error: null })),
    setApprovalPin: (pin: string) => setApproval((current) => ({ ...current, pin, error: null })),
    approve: () => {
      if (!approval.approver || !isPinComplete(approval.pin)) return;
      void submit({ user_id: approval.approver.id, pin: approval.pin });
    },
    cancelApproval: () => {
      if (!submitting) setApproval(CLOSED_APPROVAL);
    },
  };
}

export type TabCheckoutState = ReturnType<typeof useTabCheckout>;
