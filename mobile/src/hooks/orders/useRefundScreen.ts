import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ROUTES } from '@/constants/routes';
import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { orderKeys } from '@/hooks/orders/queryKeys';
import { useOrder } from '@/hooks/orders/useOrders';
import { useApproverPicker } from '@/hooks/pin/useApproverPicker';
import { usePrintJobs } from '@/hooks/printing/usePrintJobs';
import { useCurrentShift } from '@/hooks/shifts/useCurrentShift';
import { useCanReachServer } from '@/hooks/useIsOnline';
import { printRefundSlip, type ReversalPrintResult } from '@/printing/printActions';
import { centsToInputText } from '@/utils/money';
import {
  buildRefundRequest,
  clampSelection,
  defaultRefundSplit,
  fullRefundSelection,
  hasRefundableLines,
  priceRefund,
  refundableByMethod,
  remainingQty,
  REVERSAL_REASON_MAX,
  validateRefundSplit,
  type RefundSplitDraft,
  type RefundSplitErrors,
} from '@/sale/refunds';
import { findRefund, recordRefundOnTablet } from '@/sale/reversalActions';
import { classifyReversalError, type ReversalFieldErrors } from '@/sale/reversalErrors';
import { giveBackLines, REFUND_NO_SHIFT_MESSAGE, REFUND_UNCONFIRMED_MESSAGE, REVERSAL_OFFLINE_MESSAGE } from '@/sale/reversals';
import { isApiError } from '@/services/api';
import { getOrder, refundOrder } from '@/services/orders';
import type { Order, Refund, RefundCreateRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { markShiftClosedByServer } from '@/shifts/shiftActions';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { isPinComplete } from '@/utils/pin';
import { ulid as makeUlid } from '@/utils/ulid';

export const REFUND_IN_FLIGHT_RETRY_MS = 1500;
export const REFUND_IN_FLIGHT_MAX_RETRIES = 3;

export type RefundBanner = { message: string; variant: 'error' | 'warning' | 'info'; retry: boolean };

export type RefundDone = {
  order: Order;
  refund: Refund | null;
  /** "Refund done. Give back ₱33.69 cash", "Send back ₱100.00 GCash". */
  lines: string[];
  print: ReversalPrintResult | null;
};

const NO_JOBS: readonly string[] = [];
const NO_FIELD_ERRORS: ReversalFieldErrors = { lines: {} };

/**
 * The refund screen (docs/api-contract.md → Voids & Refunds (Phase 7) →
 * Refund screen, `/(app)/(pos)/orders/[ulid]/refund`). Everything typed lives
 * here, above the layout switch, so rotating keeps it.
 *
 * - **Lines:** a stepper per line with a quantity left (0 to remaining);
 *   **Refund everything** sets them all to the maximum.
 * - **Amount:** `priceRefund` (the contract's cumulative formula, `BigInt`),
 *   with the VAT split.
 * - **Payment split:** cash first up to the cash still refundable, then
 *   GCash (it follows the lines until staff edit it); never beyond what each
 *   method has left; GCash needs the reference of the transfer back.
 * - **Reason** required; without `sale.refund`, an approver
 *   (`can_approve_refunds`) and a PIN.
 * - **Submitting:** the refund `ulid` is made when the screen opens and kept
 *   until a `201`; a network error or timeout locks the form and Retry sends
 *   the same body. A quantity or checksum `422` refetches the order and
 *   re-prices; a shift `422` goes back to Sell's **Open a shift**, like a sale.
 * - **After the `201`:** the detail shows the new `Order`, the tablet stores
 *   the refund (`local_refunds`) and the new order, the refund slip prints,
 *   and the screen says what to give back.
 */
export function useRefundScreen(orderUlid: string | null) {
  const queryClient = useQueryClient();
  const query = useOrder(orderUlid);
  const order = query.data ?? null;
  const user = useSessionStore((state) => state.user);
  const ownAuthority = hasPermission(user, PERMISSIONS.saleRefund);
  const online = useCanReachServer();
  const shift = useCurrentShift();
  const picker = useApproverPicker((person) => person.can_approve_refunds);

  const [refundUlid] = useState(() => makeUlid());
  const [selection, setSelection] = useState<Record<number, number>>({});
  /** `null`: the split follows the default (cash first). */
  const [splitDraft, setSplitDraft] = useState<RefundSplitDraft | null>(null);
  const [splitErrors, setSplitErrors] = useState<RefundSplitErrors | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<ReversalFieldErrors>(NO_FIELD_ERRORS);
  const [banner, setBanner] = useState<RefundBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [approvalAsked, setApprovalAsked] = useState(false);
  const [done, setDone] = useState<RefundDone | null>(null);

  const lastBody = useRef<RefundCreateRequest | null>(null);
  const inFlight = useRef(false);
  const retries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const jobs = usePrintJobs(done?.print?.jobIds ?? NO_JOBS);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const needsApproval = !ownAuthority || approvalAsked;
  const pickerVisible = picker.approval.visible;
  const openPicker = picker.open;
  useEffect(() => {
    // Without `sale.refund`, the approver picker is part of the form.
    if (needsApproval && !pickerVisible && !done) openPicker(null);
  }, [needsApproval, pickerVisible, done, openPicker]);

  const items = useMemo(() => order?.items ?? [], [order]);
  const effective = useMemo(() => clampSelection(items, selection), [items, selection]);
  // Senior Citizen / PWD Discount: a VAT-exempt SC/PWD part is refunded VAT-exempt.
  const scPwdVatExempt = order?.sc_pwd?.vat_exempt === true;
  const pricing = useMemo(() => priceRefund(items, effective, scPwdVatExempt), [items, effective, scPwdVatExempt]);
  const refundable = useMemo(() => (order ? refundableByMethod(order) : { cash: 0, gcash: 0 }), [order]);
  const autoSplit = defaultRefundSplit(pricing.amount_cents, refundable);
  const draft: RefundSplitDraft = splitDraft ?? {
    cash: autoSplit.cash > 0 ? centsToInputText(autoSplit.cash) : '',
    gcash: autoSplit.gcash > 0 ? centsToInputText(autoSplit.gcash) : '',
    reference: '',
  };
  const split = validateRefundSplit(pricing.amount_cents, refundable, draft);
  const reason = reasonText.trim();
  const shiftUlid = shift.shift?.ulid ?? null;

  let blocker: string | null = null;
  if (!online) blocker = REVERSAL_OFFLINE_MESSAGE;
  else if (!shift.loading && shiftUlid === null) blocker = REFUND_NO_SHIFT_MESSAGE;

  const approvalReady = !needsApproval || (picker.approval.approver !== null && isPinComplete(picker.approval.pin));
  const locked = submitting || awaiting;

  function editSelection(next: Record<number, number>) {
    if (locked) return;
    setSelection(next);
    setSplitErrors(null);
    setServerErrors(NO_FIELD_ERRORS);
    setBanner(null);
  }

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard });
  }

  async function succeed(updated: Order) {
    lastBody.current = null;
    retries.current = 0;
    setAwaiting(false);
    setBanner(null);
    picker.close();
    queryClient.setQueryData(orderKeys.detail(updated.ulid), updated);
    refreshLists();
    const refund = findRefund(updated, refundUlid);
    const back = { cash: 0, gcash: 0 };
    for (const payment of refund?.payments ?? []) back[payment.method] += payment.amount_cents;
    const lines = giveBackLines('Refund done.', back);
    setDone({ order: updated, refund, lines, print: null });
    await recordRefundOnTablet(updated, refundUlid, Date.now());
    const print = refund ? await printRefundSlip(updated, refund) : null;
    if (mounted.current) setDone({ order: updated, refund, lines, print });
  }

  /** The key was already used by a request that succeeded: the order has this refund. */
  async function lookUp(message: string) {
    try {
      const current = await getOrder(orderUlid as string);
      if (findRefund(current, refundUlid)) {
        await succeed(current);
        return;
      }
      setBanner({ message, variant: 'error', retry: false });
    } catch (error) {
      setBanner({ message: isApiError(error) ? error.message : message, variant: 'error', retry: false });
    }
  }

  /** A quantity or checksum `422`: fetch the order again; the lines and the amount re-price from it. */
  async function reprice() {
    setSplitDraft(null);
    try {
      await query.refetch();
    } catch {
      // The message stays; the next attempt tells again.
    }
  }

  async function send(body: RefundCreateRequest) {
    if (inFlight.current || done || !orderUlid) return;
    lastBody.current = body;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    setServerErrors(NO_FIELD_ERRORS);
    let failure: ReturnType<typeof classifyReversalError> | null = null;
    try {
      const updated = await refundOrder(orderUlid, body);
      inFlight.current = false;
      await succeed(updated);
    } catch (error) {
      failure = classifyReversalError(error, body);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (!failure) return;

    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      setAwaiting(true);
      if (failure.kind === 'inFlight' && retries.current < REFUND_IN_FLIGHT_MAX_RETRIES) {
        retries.current += 1;
        setBanner({ message: failure.message, variant: 'info', retry: false });
        timer.current = setTimeout(() => {
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
        await lookUp(failure.message);
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
      case 'shiftClosed': {
        // Like a sale: the shift is closed here too, and Sell shows "Open a shift" with the message.
        const branchId = user?.branch.id;
        if (branchId !== undefined) await markShiftClosedByServer(body.shift_ulid, failure.message, branchId, Date.now());
        if (mounted.current) router.navigate(ROUTES.sell);
        return;
      }
      case 'invalid':
        setServerErrors(failure.fields);
        if (failure.fields.reason) setReasonError(failure.fields.reason);
        setBanner({ message: failure.message, variant: 'error', retry: false });
        if (failure.refetch) await reprice();
        return;
      case 'conflict':
        setBanner({ message: failure.message, variant: 'error', retry: false });
        await reprice();
        refreshLists();
        return;
      default:
        setBanner({ message: failure.message, variant: 'error', retry: false });
    }
  }

  function submit() {
    if (awaiting && lastBody.current) {
      void send(lastBody.current);
      return;
    }
    if (!order || blocker || shiftUlid === null) return;
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
    void send(
      buildRefundRequest({ ulid: refundUlid, shiftUlid, reason, pricing, payments: split.payments, authorization }),
    );
  }

  const editSplit = (changes: Partial<RefundSplitDraft>) => {
    if (locked) return;
    setSplitDraft({ ...draft, ...changes });
    setSplitErrors(null);
    setServerErrors((current) => ({ ...current, cash: undefined, gcash: undefined, reference: undefined, payments: undefined }));
  };

  return {
    orderUlid,
    query,
    order,
    refundUlid,
    /** The order can still be refunded. */
    refundable: order ? hasRefundableLines(order) : false,
    /** Lines with a quantity left, in the order's line order. */
    lines: items.filter((item) => remainingQty(item) > 0),
    selection: effective,
    pricing,
    /** What each method still has to refund. */
    methodsLeft: refundable,
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
    submitting,
    awaiting,
    locked,
    done,
    jobs,
    canSubmit:
      !submitting && (awaiting || (blocker === null && !shift.loading && pricing.lines.length > 0 && reason !== '' && approvalReady)),
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
    dismissBanner: () => setBanner(null),
  };
}

export type RefundScreenState = ReturnType<typeof useRefundScreen>;
