/**
 * **Refund** (docs/api-contract.md → Voids & Refunds (Phase 7) → Refund
 * screen), as a dialog over the order detail on the online-only web terminal.
 * The maths and the request are the shared ones (`@pos/core/sale/refunds`).
 *
 * - **Lines:** a quantity per line with units left (0 to remaining);
 *   **Refund everything** sets them all to the maximum.
 * - **Amount:** `priceRefund` (the contract's cumulative formula, `BigInt`),
 *   with the VAT split.
 * - **Payment split:** cash first up to the cash still refundable, then GCash
 *   (it follows the lines until staff edit it); never beyond what each method
 *   has left; GCash needs the reference of the transfer back.
 * - **Reason** required; without `sale.refund`, an approver
 *   (`can_approve_refunds`) and a PIN.
 * - **Submitting:** the refund `ulid` is made when the dialog opens and kept
 *   until a `201` (it is also the `Idempotency-Key`); a network error or
 *   timeout locks the form and Retry sends the same body. A quantity or
 *   checksum `422` refetches the order and re-prices; a shift `422` goes back
 *   to the POS screen's **Open a shift**, like a sale.
 * - **After the `201`:** the detail shows the new `Order`, the refund slip
 *   prints, and the dialog says what to give back.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useApproverPicker } from '@/hooks/useApproverPicker';
import { forgetClosedShift, shiftKeys, useCurrentShift } from '@/hooks/useCurrentShift';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { orderKeys } from '@/hooks/useOrders';
import { classifyReversalError, type ReversalFailure, type ReversalFieldErrors } from '@/sale/reversalErrors';
import { isApiError } from '@/services/api';
import { getOrder, refundOrder } from '@/services/orders';
import type { Order, Refund, RefundCreateRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { ulid as makeUlid } from '@/utils/ulid';
import { centsToInputText } from '@pos/core/money';
import {
  buildRefundRequest,
  clampSelection,
  defaultRefundSplit,
  fullRefundSelection,
  priceRefund,
  refundableByMethod,
  remainingQty,
  REVERSAL_REASON_MAX,
  validateRefundSplit,
  type RefundSplitDraft,
  type RefundSplitErrors,
} from '@pos/core/sale/refunds';
import { giveBackLines, REFUND_NO_SHIFT_MESSAGE, REFUND_UNCONFIRMED_MESSAGE } from '@pos/core/sale/reversals';

import type { ReversalBanner } from './useVoidOrder';

export const REFUND_IN_FLIGHT_RETRY_MS = 1500;
export const REFUND_IN_FLIGHT_MAX_RETRIES = 3;

export type RefundDone = {
  order: Order;
  refund: Refund | null;
  /** "Refund done. Give back ₱33.69 cash", "Send back ₱100.00 GCash". */
  lines: string[];
};

const NO_FIELD_ERRORS: ReversalFieldErrors = { lines: {} };

function findRefund(order: Order, refundUlid: string): Refund | null {
  return order.refunds.find((refund) => refund.ulid === refundUlid) ?? null;
}

/** `order`: the detail's current server `Order` (it re-renders with the refetched one). */
export function useRefundOrder(order: Order, options: { refetch: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ownAuthority = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleRefund));
  const shift = useCurrentShift();
  const picker = useApproverPicker((person) => person.can_approve_refunds);
  const printing = useOrderPrinting();

  const [open, setOpen] = useState(false);
  const [refundUlid, setRefundUlid] = useState<string>(() => makeUlid());
  const [selection, setSelection] = useState<Record<number, number>>({});
  /** `null`: the split follows the default (cash first). */
  const [splitDraft, setSplitDraft] = useState<RefundSplitDraft | null>(null);
  const [splitErrors, setSplitErrors] = useState<RefundSplitErrors | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<ReversalFieldErrors>(NO_FIELD_ERRORS);
  const [banner, setBanner] = useState<ReversalBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [approvalAsked, setApprovalAsked] = useState(false);
  const [done, setDone] = useState<RefundDone | null>(null);

  const lastBody = useRef<RefundCreateRequest | null>(null);
  const inFlight = useRef(false);
  const retries = useRef(0);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const needsApproval = !ownAuthority || approvalAsked;
  const items = order.items;
  const effective = useMemo(() => clampSelection(items, selection), [items, selection]);
  // Senior Citizen / PWD Discount: a VAT-exempt SC/PWD part is refunded VAT-exempt.
  const scPwdVatExempt = order.sc_pwd?.vat_exempt === true;
  // Dine-in (Q-048.3): the refund that leaves nothing refundable also returns the service charge.
  const serviceChargeCents = order.service_charge_cents;
  const pricing = useMemo(
    () => priceRefund(items, effective, scPwdVatExempt, undefined, serviceChargeCents),
    [items, effective, scPwdVatExempt, serviceChargeCents],
  );
  const methodsLeft = useMemo(() => refundableByMethod(order), [order]);
  const autoSplit = defaultRefundSplit(pricing.amount_cents, methodsLeft);
  const draft: RefundSplitDraft = splitDraft ?? {
    cash: autoSplit.cash > 0 ? centsToInputText(autoSplit.cash) : '',
    gcash: autoSplit.gcash > 0 ? centsToInputText(autoSplit.gcash) : '',
    reference: '',
  };
  const split = validateRefundSplit(pricing.amount_cents, methodsLeft, draft);
  const reason = reasonText.trim();
  const shiftUlid = shift.shift?.ulid ?? null;
  const blocker = !shift.loading && shiftUlid === null ? REFUND_NO_SHIFT_MESSAGE : null;
  const approvalReady = !needsApproval || picker.ready;
  const locked = submitting || awaiting;

  function editSelection(next: Record<number, number>) {
    if (locked) return;
    setSelection(next);
    setSplitErrors(null);
    setServerErrors(NO_FIELD_ERRORS);
    setBanner(null);
  }

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: orderKeys.lists });
    // The refunding shift's live report gains the refund.
    void queryClient.invalidateQueries({ queryKey: shiftKeys.all });
  }

  function succeed(updated: Order, ulid: string) {
    lastBody.current = null;
    retries.current = 0;
    setAwaiting(false);
    setBanner(null);
    picker.close();
    queryClient.setQueryData(orderKeys.detail(updated.ulid), updated);
    refreshLists();
    const refund = findRefund(updated, ulid);
    const back = { cash: 0, gcash: 0 };
    for (const payment of refund?.payments ?? []) back[payment.method] += payment.amount_cents;
    setDone({ order: updated, refund, lines: giveBackLines('Refund done.', back) });
    if (refund) void printing.printRefundSlip(updated, refund, false);
  }

  /** The key was already used by a request that succeeded: the order has this refund. */
  async function lookUp(message: string, ulid: string) {
    try {
      const current = await getOrder(order.ulid);
      if (!mounted.current) return;
      if (findRefund(current, ulid)) {
        succeed(current, ulid);
        return;
      }
      setBanner({ message, variant: 'error', retry: false });
    } catch (error) {
      if (mounted.current) setBanner({ message: isApiError(error) ? error.message : message, variant: 'error', retry: false });
    }
  }

  /** A quantity or checksum `422`: fetch the order again; the lines and the amount re-price from it. */
  async function reprice() {
    setSplitDraft(null);
    try {
      await options.refetch();
    } catch {
      // The message stays; the next attempt tells again.
    }
  }

  function handleFailure(failure: ReversalFailure, body: RefundCreateRequest) {
    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      setAwaiting(true);
      if (failure.kind === 'inFlight' && retries.current < REFUND_IN_FLIGHT_MAX_RETRIES) {
        retries.current += 1;
        setBanner({ message: failure.message, variant: 'info', retry: false });
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (mounted.current) void send(body);
        }, REFUND_IN_FLIGHT_RETRY_MS);
      } else {
        setBanner({ message: failure.kind === 'inFlight' ? failure.message : REFUND_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true });
      }
      return;
    }

    retries.current = 0;
    setAwaiting(false);
    switch (failure.kind) {
      case 'alreadyUsed':
        void lookUp(failure.message, body.ulid);
        return;
      case 'approvalRequired':
        setApprovalAsked(true);
        picker.open(failure.message);
        return;
      case 'approverRejected':
        picker.rejectApprover(failure.message);
        return;
      case 'wrongPin':
        picker.wrongPin(failure.message);
        return;
      case 'pinLocked':
        if (body.authorization) picker.showError(failure.message);
        else setBanner({ message: failure.message, variant: 'error', retry: false });
        return;
      case 'shiftClosed':
        // Like a sale: this terminal's shift is closed; the POS screen shows "Open a shift" with the message.
        forgetClosedShift(queryClient, failure.message);
        setOpen(false);
        navigate('/sell');
        return;
      case 'invalid':
        setServerErrors(failure.fields);
        if (failure.fields.reason) setReasonError(failure.fields.reason);
        setBanner({ message: failure.message, variant: 'error', retry: false });
        if (failure.refetch) void reprice();
        return;
      case 'conflict':
        setBanner({ message: failure.message, variant: 'error', retry: false });
        void reprice();
        refreshLists();
        return;
      default:
        setBanner({ message: failure.message, variant: 'error', retry: false });
    }
  }

  async function send(body: RefundCreateRequest) {
    if (inFlight.current || done) return;
    lastBody.current = body;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    setServerErrors(NO_FIELD_ERRORS);
    let failure: ReversalFailure | null = null;
    let updated: Order | null = null;
    try {
      updated = await refundOrder(order.ulid, body);
    } catch (error) {
      failure = classifyReversalError(error, body);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
    if (!mounted.current) return;
    if (updated) succeed(updated, body.ulid);
    else if (failure) handleFailure(failure, body);
  }

  function submit() {
    if (awaiting && lastBody.current) {
      void send(lastBody.current);
      return;
    }
    if (blocker || shiftUlid === null) return;
    if (pricing.lines.length === 0) {
      setBanner({ message: 'Choose what to refund.', variant: 'warning', retry: false });
      return;
    }
    let problem = false;
    if (reason === '') {
      setReasonError('Enter the reason for the refund.');
      problem = true;
    } else if (reason.length > REVERSAL_REASON_MAX) {
      setReasonError(`Use ${REVERSAL_REASON_MAX} characters or fewer.`);
      problem = true;
    }
    if (!split.payments) {
      setSplitErrors(split.errors);
      problem = true;
    }
    const authorization = needsApproval ? picker.authorization() : null;
    if (needsApproval && !authorization) problem = true;
    if (problem || !split.payments) return;
    setSplitErrors(null);
    void send(buildRefundRequest({ ulid: refundUlid, shiftUlid, reason, pricing, payments: split.payments, authorization }));
  }

  function editSplit(changes: Partial<RefundSplitDraft>) {
    if (locked) return;
    setSplitDraft({ ...draft, ...changes });
    setSplitErrors(null);
    setServerErrors((current) => ({ ...current, cash: undefined, gcash: undefined, reference: undefined, payments: undefined }));
  }

  return {
    open,
    refundUlid,
    /** Lines with a quantity left, in the order's line order. */
    lines: items.filter((item) => remainingQty(item) > 0),
    selection: effective,
    pricing,
    methodsLeft,
    split,
    draft,
    splitErrors,
    serverErrors,
    reasonText,
    reasonError,
    needsApproval,
    picker,
    banner,
    blocker,
    shiftLoading: shift.loading,
    submitting,
    awaiting,
    locked,
    done,
    printing,
    canSubmit: !submitting && (awaiting || (blocker === null && !shift.loading && pricing.lines.length > 0 && reason !== '' && approvalReady)),
    request: () => {
      if (inFlight.current) return;
      setOpen(true);
      if (done) {
        // A new refund of the same sale: start over with a new ULID.
        setDone(null);
        setRefundUlid(makeUlid());
        setSelection({});
        setSplitDraft(null);
        setReasonText('');
        setApprovalAsked(false);
        printing.reset();
      }
      setBanner(awaiting ? { message: REFUND_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true } : null);
      setSplitErrors(null);
      setReasonError(null);
      if (needsApproval && !picker.approval.visible) picker.open(null);
    },
    close: () => {
      if (inFlight.current) return;
      setOpen(false);
    },
    setQty: (itemId: number, qty: number) => editSelection({ ...effective, [itemId]: qty }),
    refundEverything: () => editSelection(fullRefundSelection(items)),
    clearLines: () => editSelection({}),
    setCash: (text: string) => editSplit({ cash: text }),
    setGcash: (text: string) => editSplit({ gcash: text }),
    setReference: (text: string) => editSplit({ reference: text }),
    /** Back to cash first, then GCash. */
    resetSplit: () => {
      if (locked) return;
      setSplitDraft(null);
      setSplitErrors(null);
    },
    setReasonText: (text: string) => {
      if (locked) return;
      setReasonText(text);
      setReasonError(null);
    },
    submit,
  };
}

export type RefundOrderState = ReturnType<typeof useRefundOrder>;
