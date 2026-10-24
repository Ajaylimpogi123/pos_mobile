/**
 * **Void sale** (docs/api-contract.md → Voids & Refunds (Phase 7) → Void
 * dialog), for the order detail on the online-only web terminal:
 *
 * - A required reason, with the quick picks (`Customer cancelled`, `Wrong
 *   order`, `Duplicate sale`, `Other…`, which asks for the words).
 * - Without `sale.void`: an approver (`pin-users` with `can_approve_voids`)
 *   and their PIN, on the dialog itself.
 * - Confirm (destructive) sends `POST /orders/{ulid}/void` with an
 *   `Idempotency-Key` made when the dialog first opens and kept until a `200`.
 *   A network error or timeout locks the dialog and offers Retry with the same
 *   key and body.
 * - After the `200`: the detail shows the voided `Order`, the lists and the
 *   shift report refresh, the void slip and the VOID kitchen tickets print,
 *   and the dialog says what to give back.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useApproverPicker } from '@/hooks/useApproverPicker';
import { shiftKeys } from '@/hooks/useCurrentShift';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { orderKeys } from '@/hooks/useOrders';
import { classifyReversalError, type ReversalFailure } from '@/sale/reversalErrors';
import { isApiError } from '@/services/api';
import { getOrder, voidOrder } from '@/services/orders';
import type { Order, VoidOrderRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { ulid as makeUlid } from '@/utils/ulid';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { giveBackLines, OTHER_REASON, VOID_UNCONFIRMED_MESSAGE, voidGiveBack } from '@pos/core/sale/reversals';

/** A `409` "still being processed" is retried after this long, up to this many times. */
export const VOID_IN_FLIGHT_RETRY_MS = 1500;
export const VOID_IN_FLIGHT_MAX_RETRIES = 3;

export type ReversalBanner = { message: string; variant: 'error' | 'warning' | 'info'; retry: boolean };

export type VoidDone = {
  order: Order;
  /** "Sale voided. Give back ₱157.00 cash", "Send back ₱100.00 GCash". */
  lines: string[];
};

export function useVoidOrder(order: Order) {
  const queryClient = useQueryClient();
  const ownAuthority = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleVoid));
  const picker = useApproverPicker((person) => person.can_approve_voids);
  const printing = useOrderPrinting();

  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [banner, setBanner] = useState<ReversalBanner | null>(null);
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
  const reason = choice === OTHER_REASON ? otherText.trim() : (choice ?? '');
  const approvalReady = !needsApproval || picker.ready;

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: orderKeys.lists });
    void queryClient.invalidateQueries({ queryKey: orderKeys.needsReviewCount });
    // The shift's live report drops the voided sale.
    void queryClient.invalidateQueries({ queryKey: shiftKeys.all });
  }

  function succeed(voided: Order) {
    key.current = null;
    lastBody.current = null;
    retries.current = 0;
    setAwaiting(false);
    setBanner(null);
    picker.close();
    queryClient.setQueryData(orderKeys.detail(voided.ulid), voided);
    refreshLists();
    setDone({ order: voided, lines: giveBackLines('Sale voided.', voidGiveBack(voided)) });
    void printing.printVoid(voided);
  }

  /** Q-004 for voids: the key was already used by a request that succeeded: read the order. */
  async function lookUp(message: string) {
    try {
      const current = await getOrder(order.ulid);
      if (!mounted.current) return;
      if (current.status === 'voided') {
        succeed(current);
        return;
      }
      setBanner({ message, variant: 'error', retry: false });
    } catch (error) {
      if (mounted.current) setBanner({ message: isApiError(error) ? error.message : message, variant: 'error', retry: false });
    }
  }

  function handleFailure(failure: ReversalFailure, body: VoidOrderRequest) {
    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      setAwaiting(true);
      if (failure.kind === 'inFlight' && retries.current < VOID_IN_FLIGHT_MAX_RETRIES) {
        retries.current += 1;
        setBanner({ message: failure.message, variant: 'info', retry: false });
        timer.current = window.setTimeout(() => {
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
        void lookUp(failure.message);
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

  async function send(body: VoidOrderRequest) {
    if (inFlight.current || done) return;
    key.current ??= makeUlid();
    lastBody.current = body;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    let failure: ReversalFailure | null = null;
    let voided: Order | null = null;
    try {
      voided = await voidOrder(order.ulid, body, key.current);
    } catch (error) {
      failure = classifyReversalError(error);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
    if (!mounted.current) return;
    if (voided) succeed(voided);
    else if (failure) handleFailure(failure, body);
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
    printing,
    canConfirm: !submitting && (awaiting || (reason !== '' && approvalReady)),
    request: () => {
      setDone(null);
      setBanner(null);
      setReasonError(null);
      printing.reset();
      // The key is made when the dialog first opens, and kept until a 200.
      key.current ??= makeUlid();
      setOpen(true);
      if (needsApproval && !picker.approval.visible) picker.open(null);
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
