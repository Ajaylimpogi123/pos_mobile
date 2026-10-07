import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ROUTES } from '@/constants/routes';
import { prepareDatabase } from '@/db/database';
import { readProductsByIds } from '@/db/menuQueries';
import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { menuKeys } from '@/hooks/menu/queryKeys';
import { orderKeys } from '@/hooks/orders/queryKeys';
import { usePinUsers } from '@/hooks/pin/usePinUsers';
import { useCurrentShift } from '@/hooks/shifts/useCurrentShift';
import { useCart } from '@/hooks/sell/useCart';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useConnectivityStore } from '@/stores/connectivity';
import { discountNeedsApproval, eligibleApprovers } from '@/sale/discountRules';
import { buildOrderRequest, priceCart } from '@/sale/order';
import { parseTableNo } from '@/sale/table';
import { OFFLINE_APPROVAL_MESSAGE, OFFLINE_SAVED_MESSAGE, saveOfflineSale } from '@/sale/offlineSale';
import { ALREADY_RECORDED_MESSAGE, classifyOrderError, EARLIER_ATTEMPT_NOTE, type OrderFailure } from '@/sale/orderErrors';
import {
  exactCashCents,
  PAYMENT_LIMITS,
  summarizeDraft,
  validateTender,
  type GcashDraft,
  type TenderDraft,
  type TenderErrors,
} from '@/sale/payments';
import { printSale } from '@/printing/printActions';
import { isApiError } from '@/services/api';
import { createOrder, getOrder } from '@/services/orders';
import type { DiscountAuthorization, OrderPaymentRequest, PinUser, PrintableOrder } from '@/services/types';
import { cartProductFrom, useCartStore } from '@/stores/cart';
import { useDeviceStore } from '@/stores/device';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import { markShiftClosedByServer, NO_SHIFT_MESSAGE, storeOnlineSale } from '@/shifts/shiftActions';
import { requestCatalogueSync } from '@/sync/catalogueSync';
import { deviceMatches, loadCachedDevice, OFFLINE_SETUP_MESSAGE } from '@/sync/deviceRegistration';
import { requestStockSync } from '@/sync/stockSync';
import { centsToInputText, parsePesoInput } from '@/utils/money';
import { goBackOr } from '@/utils/navigation';
import { isPinComplete } from '@/utils/pin';

/** Offline, when nothing blocks: the sale will be saved on the tablet. */
export const OFFLINE_CHECKOUT_MESSAGE = 'No connection. This sale will be saved on this tablet and synced later.';

/** The server looked unreachable, but this tablet was never set up for offline sales. */
export const SERVER_UNREACHABLE_UNREGISTERED_MESSAGE =
  "Can't reach the server. This tablet isn't set up for offline sales yet, so the sale will be sent to the server.";

/** A `409` "still being processed" is retried after this long… */
export const IN_FLIGHT_RETRY_MS = 1500;
/** …up to this many times; then the cashier retries by hand. */
export const IN_FLIGHT_MAX_RETRIES = 3;

export type CheckoutBanner = {
  message: string;
  variant: 'error' | 'warning' | 'info';
  /**
   * Show a Retry button: `resubmit` resends the unconfirmed sale; `lookup` repeats the
   * `GET /orders/{ulid}` of a sale an earlier attempt already created (Q-004).
   */
  retry: false | 'resubmit' | 'lookup';
  /** A second line, e.g. why the sale couldn't be saved on the tablet instead (Offline Sales). */
  detail?: string | null;
};

export type ApprovalState = {
  visible: boolean;
  step: 'pick' | 'pin';
  approver: PinUser | null;
  pin: string;
  /** Under the picker or the PIN pad (wrong PIN, can't approve, locked PIN). */
  error: string | null;
  /** Why approval is asked for (the server's message, when it asked). */
  reason: string | null;
};

const CLOSED_APPROVAL: ApprovalState = { visible: false, step: 'pick', approver: null, pin: '', error: null, reason: null };

let nextGcashNumber = 1;

/**
 * Checkout (docs/api-contract.md → Core Sale → App → Checkout, Approval,
 * Submitting, Success). The typed payments live in the cart store and the
 * rest in this hook, above every layout switch, so rotating (or leaving
 * checkout and coming back) never loses them.
 *
 * - Payments: cash (with quick amounts), GCash (reference required), split
 *   tender, and the live amount due or change.
 * - Submitting sends the cart's **pending ULID** (generated when checkout
 *   started) as both `ulid` and `Idempotency-Key`, and keeps it until a 201.
 *   A `409` in-flight is retried shortly.
 * - Offline Sales (Phase 5), online first with an offline fallback:
 *   - **Offline** (expo-network, or the server left the last request unanswered: the breaker in
 *     `@/stores/connectivity`): no request; the sale is saved on the tablet
 *     (`saveOfflineSale`) and completes with `No connection — sale saved on this tablet.`
 *   - **Timeout / network error** on `POST /orders`: the sale is saved on the
 *     tablet with the **same ULID**, so a sale the server did commit syncs back
 *     as `duplicate`. When it can't be (never registered; a manager's approval
 *     was part of it — Q-011, resolved), the cart and the payments are locked and
 *     "Retry" resends the same body with the same ULID, as in Phase 3.
 *   - A 4xx keeps its Phase 3 handling and never falls back.
 *   - Blocked offline: a discount that needs approval (`Needs a manager
 *     approval — connect to the internet.`) and a tablet that never registered
 *     (`Connect once to set up offline sales.`).
 * - `422`s: stock / menu / discount problems go back to the cart with the
 *   messages on their lines; the checksum starts a catalogue sync and
 *   re-prices the cart; the approval errors drive the approver picker and PIN pad.
 * - Printing (Phase 4): right after either success path (a 201, or the Q-004
 *   lookup), `printSale` queues the receipt and tickets without waiting.
 * - Shifts & Reporting (Phase 6): a sale needs this tablet's open shift; its
 *   ULID goes into both bodies as `shift_ulid`. Every completed online sale is
 *   stored on the tablet as `synced` (the shift report). A `422` "This shift is
 *   closed. Open a new shift." closes the shift here and goes back to Sell,
 *   which shows "Open a shift" (the cart is kept).
 * - Approval: needed when the app can tell (the user's permissions and role
 *   limit) or when the server says so; approvers come from `pin-users`,
 *   filtered by `can_approve_discounts` and `max_discount_percent`.
 */
export function useCheckout() {
  const cart = useCart();
  const user = useSessionStore((state) => state.user);
  const draft = useCartStore((state) => state.tender);
  const deviceConnected = useIsOnline();
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  // The circuit breaker: after one request that got no answer, sales are saved on the tablet at once.
  const online = deviceConnected && serverReachable;
  const queryClient = useQueryClient();
  const deviceLoaded = useDeviceStore((state) => state.loaded);
  const device = useDeviceStore((state) => state.device);
  const currentShift = useCurrentShift();

  const [tenderErrors, setTenderErrors] = useState<TenderErrors | null>(null);
  const [banner, setBanner] = useState<CheckoutBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [repricing, setRepricing] = useState(false);
  /** The server's `Order`, or the local order of a sale saved on the tablet. */
  const [completed, setCompleted] = useState<PrintableOrder | null>(null);
  /** Shown on the success screen when an earlier attempt had already completed the sale (Q-004). */
  const [completedNote, setCompletedNote] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalState>(CLOSED_APPROVAL);

  const inFlight = useRef(false);
  /** The approval sent with the last attempt: a retry of an unconfirmed sale must send it again. */
  const lastAuthorization = useRef<DiscountAuthorization | null>(null);
  const inFlightRetries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The shift the last attempt was sent with (Phase 6: the closed-shift 422 closes it). */
  const lastShiftUlid = useRef<string | null>(null);
  /** The server's "already used" 409 message, kept while the earlier sale is looked up (Q-004). */
  const alreadyUsedMessage = useRef('');
  /** Still on screen: a late answer after the cashier left checkout must not navigate again. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  // Whether this tablet can number offline sales (the cached registration).
  useEffect(() => {
    if (!deviceLoaded) void loadCachedDevice();
  }, [deviceLoaded]);

  const pinUsers = usePinUsers(approval.visible);
  const approvers = eligibleApprovers(pinUsers.items, cart.pricing);
  const summary = summarizeDraft(cart.pricing.total_cents, draft);
  const locked = cart.awaitingConfirmation || submitting;
  const registered = deviceMatches(device, user?.branch.id ?? null);

  /** Why this sale can't be completed while offline (`null`: it can be saved on the tablet). */
  let offlineBlock: string | null = null;
  if (!online) {
    if (cart.needsApproval) offlineBlock = OFFLINE_APPROVAL_MESSAGE;
    // Unknown until the cache is read: the save checks again. With the device connected, an
    // unregistered tablet still tries the server (it may be back), so only a lost connection blocks.
    else if (!deviceConnected && deviceLoaded && !registered) offlineBlock = OFFLINE_SETUP_MESSAGE;
  }
  /** Phase 6: why no sale can be completed here (no open shift on this tablet), or `null`. */
  const shiftBlock = !currentShift.loading && currentShift.shift === null ? (currentShift.error ?? NO_SHIFT_MESSAGE) : null;
  /** Offline, when nothing blocks: what happens to the sale. */
  let offlineNotice: string | null = null;
  if (!online && offlineBlock === null) {
    offlineNotice = deviceLoaded && !registered ? SERVER_UNREACHABLE_UNREGISTERED_MESSAGE : OFFLINE_CHECKOUT_MESSAGE;
  }

  function editDraft(next: (current: TenderDraft) => TenderDraft) {
    if (locked) return;
    const store = useCartStore.getState();
    store.setTender(next(store.tender));
    setTenderErrors(null);
  }

  function invalidateAfterSale() {
    void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard });
    // Sales deplete stock: the admin product cards show `stock_qty`.
    void queryClient.invalidateQueries({ queryKey: menuKeys.productLists() });
  }

  /** After a checksum 422: pull the menu, re-price the cart from it, and show the server's message. */
  async function repriceFromMenu(message: string) {
    setRepricing(true);
    setBanner({ message, variant: 'warning', retry: false });
    try {
      await requestCatalogueSync();
      if (await prepareDatabase()) {
        const ids = useCartStore.getState().lines.map((line) => line.product.id);
        const rows = await readProductsByIds(ids);
        useCartStore.getState().repriceProducts(rows.map(cartProductFrom));
      }
    } catch {
      // The cart keeps its prices; the message stays, and the next attempt tells again.
    } finally {
      setRepricing(false);
    }
  }

  function handleFailure(failure: OrderFailure, authorization: DiscountAuthorization | null, detail: string | null = null) {
    const store = useCartStore.getState();

    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      // The sale may have gone through: lock the cart and resend the same body with the same ULID.
      lastAuthorization.current = authorization;
      store.setAwaitingConfirmation(true);
      setApproval(CLOSED_APPROVAL);
      if (failure.kind === 'inFlight' && inFlightRetries.current < IN_FLIGHT_MAX_RETRIES) {
        inFlightRetries.current += 1;
        setBanner({ message: failure.message, variant: 'info', retry: false });
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void submit(authorization);
        }, IN_FLIGHT_RETRY_MS);
      } else {
        setBanner({ message: failure.message, variant: 'warning', retry: 'resubmit', detail });
      }
      return;
    }

    if (failure.kind === 'alreadyUsed') {
      // Q-004: an earlier attempt with this ULID created the sale. The cart stays locked with its ULID.
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
        void repriceFromMenu(failure.message);
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
        if (mounted.current) goBackOr(ROUTES.sell);
        return;
      case 'payments':
        setApproval(CLOSED_APPROVAL);
        setTenderErrors({ gcash: {}, general: failure.message });
        return;
      case 'shiftClosed': {
        // Phase 6: the server has this shift closed. Close it here too, and open a new one from Sell.
        setApproval(CLOSED_APPROVAL);
        const branchId = useSessionStore.getState().user?.branch.id;
        if (lastShiftUlid.current && branchId !== undefined) {
          void markShiftClosedByServer(lastShiftUlid.current, failure.message, branchId, Date.now());
        }
        if (mounted.current) goBackOr(ROUTES.sell);
        return;
      }
      default:
        setApproval(CLOSED_APPROVAL);
        setBanner({ message: failure.message, variant: 'error', retry: false });
    }
  }

  /**
   * Q-004: `GET /orders/{ulid}` with the pending ULID. 200 → the success screen from that
   * `Order`, with a note, then the cart and its ULID are cleared. 404 / 403 → the sale can't be
   * shown here: say so, and keep the cart locked with its ULID. Anything else (e.g. no network)
   * → keep the message and offer Retry, which repeats the lookup.
   */
  async function lookUpEarlierSale() {
    const ulid = useCartStore.getState().pendingUlid;
    if (!ulid || inFlight.current || completed) return;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    try {
      const order = await getOrder(ulid);
      lastAuthorization.current = null;
      const signedIn = useSessionStore.getState().user;
      if (signedIn) void storeOnlineSale(order, lastShiftUlid.current ?? order.shift_ulid, signedIn, Date.now());
      setCompleted(order);
      setCompletedNote(EARLIER_ATTEMPT_NOTE);
      useCartStore.getState().completeSale();
      invalidateAfterSale();
      // Printing never blocks the sale; a first print already sent is never sent again (dedupe).
      void printSale(order);
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

  /** The sale as it stands: the checked cart, table number and payments (`null` when something must be fixed first). */
  function readySale() {
    const store = useCartStore.getState();
    if (store.lines.length === 0) return null;
    const pricing = priceCart(store.lines, store.orderDiscount, store.scPwd);
    if (!pricing.valid) return null;
    const table = parseTableNo(store.tableNo);
    if (table.error) return null;

    const tender = validateTender(pricing.total_cents, store.tender);
    if (!tender.payments) {
      setTenderErrors(tender.errors);
      return null;
    }
    setTenderErrors(null);
    return { store, pricing, tableNo: table.value, payments: tender.payments };
  }

  /**
   * Saves the sale on the tablet (one SQLite transaction), then shows the
   * success screen from the local order and prints it. `null` on success,
   * else why it couldn't be saved (nothing was recorded).
   */
  async function completeOffline(
    ulid: string,
    payments: OrderPaymentRequest[],
    tableNo: string | null,
    shiftUlid: string,
  ): Promise<string | null> {
    const store = useCartStore.getState();
    const signedIn = useSessionStore.getState().user;
    if (!signedIn) return OFFLINE_SETUP_MESSAGE;

    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    try {
      const outcome = await saveOfflineSale({
        ulid,
        lines: store.lines,
        orderDiscount: store.orderDiscount,
        customer: store.customer,
        tableNo,
        payments,
        pricing: priceCart(store.lines, store.orderDiscount, store.scPwd),
        user: signedIn,
        shiftUlid,
        // Senior Citizen / PWD Discount: an offline sale carries its SC/PWD (never an approval).
        scPwd: store.scPwd,
        now: Date.now(),
      });
      if (!outcome.ok) return outcome.message;

      inFlightRetries.current = 0;
      lastAuthorization.current = null;
      setCompleted(outcome.order);
      setCompletedNote(OFFLINE_SAVED_MESSAGE);
      setApproval(CLOSED_APPROVAL);
      useCartStore.getState().completeSale();
      invalidateAfterSale();
      // The printers are on the LAN: the local order prints at once, through the same queue.
      void printSale(outcome.order);
      return null;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function submit(authorization: DiscountAuthorization | null = null) {
    if (inFlight.current || completed) return;
    const sale = readySale();
    if (!sale) return;
    const { store, pricing } = sale;
    const cashier = useSessionStore.getState().user;
    const needsApproval = discountNeedsApproval(pricing, cashier);
    // Phase 6: sales need this tablet's open shift. A retry of an unconfirmed sale keeps its shift (the same body).
    const shiftUlid = (store.awaitingConfirmation ? lastShiftUlid.current : null) ?? useShiftStore.getState().current?.ulid ?? null;
    if (!shiftUlid) {
      setBanner({ message: NO_SHIFT_MESSAGE, variant: 'warning', retry: false });
      return;
    }
    lastShiftUlid.current = shiftUlid;

    if (!online) {
      // Offline: no PIN checks, so only discounts within the cashier's own limit.
      if (needsApproval) {
        setBanner({ message: OFFLINE_APPROVAL_MESSAGE, variant: 'warning', retry: false });
        return;
      }
      store.clearServerErrors();
      const problem = await completeOffline(store.beginCheckout(), sale.payments, sale.tableNo, shiftUlid);
      if (problem === null) return;
      // Connected but the server looked down, and the tablet can't save it: try the server after all.
      if (!(deviceConnected && problem === OFFLINE_SETUP_MESSAGE)) {
        setBanner({ message: problem, variant: 'warning', retry: false });
        return;
      }
    }

    if (!authorization && needsApproval) {
      setApproval({ ...CLOSED_APPROVAL, visible: true });
      return;
    }

    const ulid = store.beginCheckout();
    const body = buildOrderRequest({
      ulid,
      lines: store.lines,
      orderDiscount: store.orderDiscount,
      customer: store.customer,
      tableNo: sale.tableNo,
      payments: sale.payments,
      clientTotalCents: pricing.total_cents,
      authorization,
      shiftUlid,
      scPwd: store.scPwd,
    });

    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    store.clearServerErrors();
    let failure: OrderFailure | null = null;
    try {
      const order = await createOrder(body);
      inFlightRetries.current = 0;
      lastAuthorization.current = null;
      // The success screen first, then the cart (and its ULID) is cleared: a new sale gets a new ULID.
      setCompleted(order);
      setApproval(CLOSED_APPROVAL);
      useCartStore.getState().completeSale();
      invalidateAfterSale();
      // Phase 6: every completed sale is stored on the tablet (the shift report).
      if (cashier) void storeOnlineSale(order, shiftUlid, cashier, Date.now());
      // The advisory stock cache follows each online sale.
      void requestStockSync();
      // The receipt and tickets print in the background: printing never blocks or reverses a sale.
      void printSale(order);
    } catch (error) {
      failure = classifyOrderError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (!failure) return;

    if (failure.kind === 'unconfirmed') {
      // A network error or timeout: save it on the tablet with the SAME ulid (the server may have
      // committed it; then it syncs back as `duplicate`). A manager's approval can't be carried
      // offline, so such a sale keeps the Phase 3 retry (Q-011, resolved: no fallback with an approval).
      if (authorization === null && !needsApproval) {
        const problem = await completeOffline(ulid, sale.payments, sale.tableNo, shiftUlid);
        if (problem === null) return;
        handleFailure(failure, authorization, problem);
        return;
      }
      handleFailure(failure, authorization, OFFLINE_APPROVAL_MESSAGE);
      return;
    }
    // Handled once this attempt has settled, so a follow-up request (e.g. the Q-004 lookup) can run.
    handleFailure(failure, authorization);
  }

  function addGcash() {
    editDraft((current) => {
      if (current.gcash.length >= PAYMENT_LIMITS.maxPayments - 1) return current;
      // Prefill with what is still owed.
      const due = summarizeDraft(cart.pricing.total_cents, current).dueCents;
      const row: GcashDraft = { key: `gcash-${nextGcashNumber}`, amount: due > 0 ? centsToInputText(due) : '', reference: '' };
      nextGcashNumber += 1;
      return { ...current, gcash: [...current.gcash, row] };
    });
  }

  return {
    cart,
    user,
    online,
    draft,
    summary,
    tenderErrors,
    banner,
    submitting,
    repricing,
    completed,
    completedNote,
    /** Repeats the lookup of a sale an earlier attempt already created (Q-004). */
    retryLookup: () => void lookUpEarlierSale(),
    /** Payments can't change while a sale is in flight or unconfirmed (the retry must match). */
    locked,
    canAddGcash: !locked && draft.gcash.length < PAYMENT_LIMITS.maxPayments - 1,
    /** Offline Sales: why the sale can't be completed while offline (`null`: it will be saved on the tablet). */
    offlineBlock,
    /** Offline Sales hardening: shown while offline (or the server is unreachable) when nothing blocks. */
    offlineNotice,
    /** Phase 6: no open shift on this tablet (`null`: a shift is open). */
    shiftBlock,
    canConfirm:
      shiftBlock === null &&
      !currentShift.loading &&
      offlineBlock === null &&
      !cart.isEmpty &&
      !cart.hasProblems &&
      !submitting &&
      !repricing &&
      (cart.awaitingConfirmation || (!summary.short && !summary.gcashOverTotal)),
    setCash: (text: string) => editDraft((current) => ({ ...current, cash: text })),
    setQuickCash: (cents: number) =>
      editDraft((current) => ({ ...current, cash: cents > 0 ? centsToInputText(cents) : '' })),
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
    removeGcash: (key: string) =>
      editDraft((current) => ({ ...current, gcash: current.gcash.filter((row) => row.key !== key) })),
    /** Confirm (or Retry the unconfirmed attempt, with the same ULID and approval). */
    confirm: () => void submit(cart.awaitingConfirmation ? lastAuthorization.current : null),
    dismissBanner: () => setBanner(null),
    approval,
    approvers,
    approversLoading: pinUsers.grid.loading,
    approversError: pinUsers.grid.error,
    retryApprovers: pinUsers.grid.onRetry,
    chooseApprover: (person: PinUser) =>
      setApproval((current) => ({ ...current, step: 'pin', approver: person, pin: '', error: null })),
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

export type CheckoutState = ReturnType<typeof useCheckout>;

/** A typed cash amount as centavos for the quick-amount buttons' selected state (`null` when blank or invalid). */
export function typedCents(text: string): number | null {
  return text.trim() === '' ? null : parsePesoInput(text);
}
