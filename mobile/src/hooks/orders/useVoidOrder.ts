import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { orderKeys } from '@/hooks/orders/queryKeys';
import { useApproverPicker } from '@/hooks/pin/useApproverPicker';
import { usePrintJobs } from '@/hooks/printing/usePrintJobs';
import { printVoid, type ReversalPrintResult } from '@/printing/printActions';
import { recordVoidOnTablet } from '@/sale/reversalActions';
import { classifyReversalError } from '@/sale/reversalErrors';
import { giveBackLines, OTHER_REASON, VOID_UNCONFIRMED_MESSAGE, voidGiveBack } from '@pos/core/sale/reversals';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { isApiError } from '@/services/api';
import { getOrder, voidOrder } from '@/services/orders';
import type { Order, PrintableOrder, VoidOrderRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { isPinComplete } from '@/utils/pin';
import { ulid as makeUlid } from '@/utils/ulid';

/** A `409` "still being processed" is retried after this long, up to this many times. */
export const VOID_IN_FLIGHT_RETRY_MS = 1500;
export const VOID_IN_FLIGHT_MAX_RETRIES = 3;

export type VoidBanner = { message: string; variant: 'error' | 'warning' | 'info'; retry: boolean };

export type VoidDone = {
  order: Order;
  /** "Sale voided. Give back ₱157.00 cash", "Send back ₱100.00 GCash". */
  lines: string[];
  print: ReversalPrintResult | null;
};

const NO_JOBS: readonly string[] = [];

/**
 * **Void sale** (docs/api-contract.md → Voids & Refunds (Phase 7) → Void
 * dialog), for the order detail:
 *
 * - A required reason, with quick picks (`Customer cancelled`, `Wrong order`,
 *   `Duplicate sale`, `Other…`, which asks for the words).
 * - Without `sale.void`: an approver picker (`pin-users` with
 *   `can_approve_voids`) and a PIN pad, on the dialog itself.
 * - Confirm (destructive) sends `POST /orders/{ulid}/void` with an
 *   `Idempotency-Key` made when the dialog first opens and kept until a
 *   `200` (a failed request never uses it up). A network error or timeout
 *   locks the dialog and offers Retry with the same key and body.
 * - After the `200`: the order detail shows the voided `Order`, the tablet's
 *   stored copy is replaced (its shift report drops the sale), the void slip
 *   and the VOID kitchen tickets print, and the dialog says what to give back.
 */
export function useVoidOrder(order: PrintableOrder) {
  const queryClient = useQueryClient();
  const ownAuthority = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleVoid));
  const picker = useApproverPicker((person) => person.can_approve_voids);

  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [banner, setBanner] = useState<VoidBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** The last attempt got no answer: the dialog is locked and Retry resends the same body. */
  const [awaiting, setAwaiting] = useState(false);
  /** The server asked for an approval the app didn't expect (e.g. the permissions changed). */
  const [approvalAsked, setApprovalAsked] = useState(false);
  const [done, setDone] = useState<VoidDone | null>(null);

  const key = useRef<string | null>(null);
  const lastBody = useRef<VoidOrderRequest | null>(null);
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
  const reason = choice === OTHER_REASON ? otherText.trim() : (choice ?? '');
  const approvalReady = !needsApproval || (picker.approval.approver !== null && isPinComplete(picker.approval.pin));

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard });
  }

  async function succeed(voided: Order) {
    key.current = null;
    lastBody.current = null;
    retries.current = 0;
    setAwaiting(false);
    setBanner(null);
    picker.close();
    queryClient.setQueryData(orderKeys.detail(voided.ulid), voided);
    refreshLists();
    const lines = giveBackLines('Sale voided.', voidGiveBack(voided));
    setDone({ order: voided, lines, print: null });
    await recordVoidOnTablet(voided, Date.now());
    const print = await printVoid(voided);
    if (mounted.current) setDone({ order: voided, lines, print });
  }

  /** Q-004 for voids: the key was already used by a request that succeeded: read the order. */
  async function lookUp(message: string) {
    try {
      const current = await getOrder(order.ulid);
      if (current.status === 'voided') {
        await succeed(current);
        return;
      }
      setBanner({ message, variant: 'error', retry: false });
    } catch (error) {
      setBanner({ message: isApiError(error) ? error.message : message, variant: 'error', retry: false });
    }
  }

  async function send(body: VoidOrderRequest) {
    if (inFlight.current || done) return;
    if (!key.current) key.current = makeUlid();
    lastBody.current = body;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    let failure: ReturnType<typeof classifyReversalError> | null = null;
    try {
      const voided = await voidOrder(order.ulid, body, key.current);
      inFlight.current = false;
      await succeed(voided);
    } catch (error) {
      failure = classifyReversalError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (!failure) return;

    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      setAwaiting(true);
      if (failure.kind === 'inFlight' && retries.current < VOID_IN_FLIGHT_MAX_RETRIES) {
        retries.current += 1;
        setBanner({ message: failure.message, variant: 'info', retry: false });
        timer.current = setTimeout(() => {
          timer.current = null;
          if (mounted.current) void send(body);
        }, VOID_IN_FLIGHT_RETRY_MS);
      } else {
        setBanner({ message: failure.kind === 'inFlight' ? failure.message : VOID_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true });
      }
      return;
    }

    // Any other answer is final for this attempt (the key isn't used up).
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
      case 'invalid':
        if (failure.fields.reason) setReasonError(failure.fields.reason);
        else setBanner({ message: failure.message, variant: 'error', retry: false });
        return;
      case 'conflict':
        // The sale's state or window changed (e.g. its shift closed): show why, and the order as it is now.
        setBanner({ message: failure.message, variant: 'error', retry: false });
        void queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.ulid) });
        refreshLists();
        return;
      default:
        setBanner({ message: failure.message, variant: 'error', retry: false });
    }
  }

  function confirm() {
    if (awaiting && lastBody.current) {
      void send(lastBody.current);
      return;
    }
    if (reason === '') {
      setReasonError(choice === OTHER_REASON ? 'Enter the reason.' : 'Choose a reason.');
      return;
    }
    if (reason.length > REVERSAL_REASON_MAX) {
      setReasonError(`Use ${REVERSAL_REASON_MAX} characters or fewer.`);
      return;
    }
    const authorization = needsApproval ? picker.authorization() : null;
    if (needsApproval && !authorization) return;
    void send({ reason, authorization });
  }

  const locked = submitting || awaiting;

  return {
    open,
    /** Without `sale.void`, a manager approves on the dialog. */
    needsApproval,
    picker,
    choice,
    otherText,
    reasonError,
    banner,
    submitting,
    awaiting,
    locked,
    done,
    jobs,
    canConfirm: !submitting && (awaiting || (reason !== '' && approvalReady)),
    request: () => {
      setDone(null);
      setBanner(null);
      setReasonError(null);
      setOpen(true);
      if (needsApproval) picker.open(null);
    },
    close: () => {
      if (inFlight.current) return;
      setOpen(false);
      if (!awaiting) picker.close();
    },
    choose: (value: string) => {
      if (locked) return;
      setChoice(value);
      setReasonError(null);
    },
    setOtherText: (text: string) => {
      if (locked) return;
      setOtherText(text);
      setReasonError(null);
    },
    confirm,
  };
}

export type VoidOrderState = ReturnType<typeof useVoidOrder>;
