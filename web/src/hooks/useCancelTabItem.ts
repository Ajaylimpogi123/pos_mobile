/**
 * **Cancel** a sent item (Dine-in Tables & Tabs §D.5): a quantity (1 …
 * `remaining_qty`), a required reason, and, without `sale.void`, a manager
 * with `sale.void` and their PIN (the void's authority rules and the same
 * approver picker). `Idempotency-Key`: made when the dialog opens, kept until
 * a `200`; a network error or timeout locks the dialog and Retry resends the
 * same body. After the `200`, the VOID kitchen ticket prints for that quantity.
 */
import { useEffect, useRef, useState } from 'react';

import { useApproverPicker } from '@/hooks/useApproverPicker';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { useTabCache } from '@/hooks/useTab';
import { classifyReversalError, type ReversalFailure } from '@/sale/reversalErrors';
import { isApiValidationError } from '@/services/api';
import { cancelTabItem } from '@/services/tabs';
import type { Tab, TabItem, TabItemCancelRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { ulid as makeUlid } from '@/utils/ulid';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { OTHER_REASON } from '@pos/core/sale/reversals';

export const CANCEL_UNCONFIRMED_MESSAGE = "We couldn't confirm the cancel. Retry: it won't be done twice.";

type Banner = { message: string; variant: 'error' | 'warning' | 'info' };

export function useCancelTabItem(tab: Tab | null, onConflict: (message: string) => void) {
  const saveTab = useTabCache();
  const printing = useOrderPrinting();
  const ownAuthority = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleVoid));
  const picker = useApproverPicker((person) => person.can_approve_voids);

  const [item, setItem] = useState<TabItem | null>(null);
  const [qtyText, setQtyText] = useState('1');
  const [choice, setChoice] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [errors, setErrors] = useState<{ qty?: string; reason?: string }>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [approvalAsked, setApprovalAsked] = useState(false);

  const key = useRef<string | null>(null);
  const lastBody = useRef<TabItemCancelRequest | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const needsApproval = !ownAuthority || approvalAsked;
  const reason = choice === OTHER_REASON ? otherText.trim() : (choice ?? '');
  const locked = submitting || awaiting;

  function reset() {
    key.current = null;
    lastBody.current = null;
    setAwaiting(false);
    setBanner(null);
    setErrors({});
    setChoice(null);
    setOtherText('');
    setApprovalAsked(false);
    picker.close();
  }

  function handleFailure(failure: ReversalFailure, body: TabItemCancelRequest) {
    if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
      setAwaiting(true);
      setBanner({ message: failure.kind === 'inFlight' ? failure.message : CANCEL_UNCONFIRMED_MESSAGE, variant: 'warning' });
      return;
    }
    setAwaiting(false);
    switch (failure.kind) {
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
        else setBanner({ message: failure.message, variant: 'error' });
        return;
      case 'invalid':
        if (failure.fields.reason) setErrors({ reason: failure.fields.reason });
        else setBanner({ message: failure.message, variant: 'error' });
        return;
      case 'conflict':
      case 'alreadyUsed':
        // The bill changed (or was closed) on another device: the dialog shows it and reloads the tab.
        setItem(null);
        reset();
        onConflict(failure.message);
        return;
      default:
        setBanner({ message: failure.message, variant: 'error' });
    }
  }

  async function send(body: TabItemCancelRequest) {
    if (!tab || !item || inFlight.current) return;
    key.current ??= makeUlid();
    const cancelKey = key.current;
    lastBody.current = body;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    let failure: ReversalFailure | null = null;
    let updated: Tab | null = null;
    try {
      updated = await cancelTabItem(tab.ulid, item.id, body, cancelKey);
    } catch (error) {
      failure = classifyReversalError(error);
      // `qty` (1 … remaining) has its own field.
      if (failure.kind === 'invalid' && isApiValidationError(error)) {
        const qtyMessage = error.firstError('qty');
        if (qtyMessage) {
          setErrors({ qty: qtyMessage });
          failure = null;
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
    if (!mounted.current) return;
    if (updated) {
      const cancelled = item;
      saveTab(updated);
      reset();
      setItem(null);
      void printing.printTabCancel(updated, cancelled, body.qty, cancelKey);
    } else if (failure) {
      handleFailure(failure, body);
    }
  }

  function confirm() {
    if (!item) return;
    if (awaiting && lastBody.current) {
      void send(lastBody.current);
      return;
    }
    const next: { qty?: string; reason?: string } = {};
    const qty = /^\d{1,3}$/.test(qtyText.trim()) ? Number(qtyText.trim()) : NaN;
    if (!(qty >= 1 && qty <= item.remaining_qty)) next.qty = `Enter 1 to ${item.remaining_qty}.`;
    if (reason === '') next.reason = choice === OTHER_REASON ? 'Enter the reason.' : 'Choose a reason.';
    else if (reason.length > REVERSAL_REASON_MAX) next.reason = `Use ${REVERSAL_REASON_MAX} characters or fewer.`;
    setErrors(next);
    if (next.qty || next.reason) return;
    const authorization = needsApproval ? picker.authorization() : null;
    if (needsApproval && !authorization) return;
    void send({ qty, reason, authorization });
  }

  return {
    item,
    qtyText,
    choice,
    otherText,
    errors,
    banner,
    submitting,
    awaiting,
    locked,
    needsApproval,
    picker,
    /** The VOID tickets' print status (shown on the tab screen). */
    printing,
    canConfirm: !submitting && (awaiting || (reason !== '' && (!needsApproval || picker.ready))),
    open: (target: TabItem) => {
      if (inFlight.current) return;
      // A different item (or a fresh cancel): a new key; an unconfirmed attempt keeps its key and body.
      if (!awaiting || item?.id !== target.id) reset();
      setItem(target);
      setQtyText('1');
      if (!ownAuthority) picker.open(null);
    },
    close: () => {
      if (inFlight.current) return;
      setItem(null);
    },
    setQty: (text: string) => {
      if (locked) return;
      setQtyText(text.replace(/\D/g, '').slice(0, 3));
      setErrors((current) => ({ ...current, qty: undefined }));
    },
    choose: (value: string) => {
      if (locked) return;
      setChoice(value);
      setErrors((current) => ({ ...current, reason: undefined }));
    },
    setOtherText: (text: string) => {
      if (locked) return;
      setOtherText(text);
      setErrors((current) => ({ ...current, reason: undefined }));
    },
    confirm,
  };
}

export type CancelTabItemState = ReturnType<typeof useCancelTabItem>;
