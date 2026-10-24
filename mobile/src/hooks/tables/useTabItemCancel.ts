import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { tableKeys } from '@/hooks/tables/queryKeys';
import { useApproverPicker } from '@/hooks/pin/useApproverPicker';
import { printTabVoid, type TabPrintResult } from '@/printing/printActions';
import { classifyReversalError } from '@/sale/reversalErrors';
import { cancelTabItem } from '@/services/tables';
import type { Tab, TabItem, TabItemCancelRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { isPinComplete } from '@/utils/pin';
import { ulid as makeUlid } from '@/utils/ulid';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { OTHER_REASON } from '@pos/core/sale/reversals';

import { isTabConflict } from './useTab';

/** Quick reasons for cancelling a sent item (any other is typed after "Other…"). */
export const CANCEL_REASONS = ['Customer changed their mind', 'Wrong item', "Kitchen can't make it"] as const;

export const CANCEL_UNCONFIRMED_MESSAGE = "We couldn't confirm the cancel. Retry: it won't be done twice.";

export type CancelBanner = { message: string; variant: 'error' | 'warning' | 'info'; retry: boolean };

type Draft = {
  item: TabItem;
  qty: number;
  /** The `Idempotency-Key`, made when the dialog opens and kept until a 200. */
  key: string;
};

/**
 * **Cancel** a sent item (Dine-in Tables & Tabs §D.5): a quantity (1 …
 * remaining), a required reason with quick picks, and, without `sale.void`,
 * a manager's approval (approver with `can_approve_voids` + PIN), exactly as
 * a void. After the `200` the tab is replaced and a VOID kitchen ticket
 * prints for the cancelled quantity. A `409` closes the dialog and goes to
 * the tab's conflict dialog (`onConflict`).
 */
export function useTabItemCancel(tab: Tab | null, onConflict: (message: string) => void) {
  const client = useQueryClient();
  const ownAuthority = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleVoid));
  const picker = useApproverPicker((person) => person.can_approve_voids);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [banner, setBanner] = useState<CancelBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [approvalAsked, setApprovalAsked] = useState(false);
  const [print, setPrint] = useState<TabPrintResult | null>(null);
  const lastBody = useRef<TabItemCancelRequest | null>(null);
  const inFlight = useRef(false);

  const needsApproval = !ownAuthority || approvalAsked;
  const reason = choice === OTHER_REASON ? otherText.trim() : (choice ?? '');
  const approvalReady = !needsApproval || (picker.approval.approver !== null && isPinComplete(picker.approval.pin));
  const locked = submitting || awaiting;

  function reset() {
    setDraft(null);
    setChoice(null);
    setOtherText('');
    setReasonError(null);
    setBanner(null);
    setAwaiting(false);
    setApprovalAsked(false);
    lastBody.current = null;
    picker.close();
  }

  async function send(body: TabItemCancelRequest) {
    if (!draft || !tab || inFlight.current) return;
    lastBody.current = body;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    let failure: unknown = null;
    try {
      const next = await cancelTabItem(tab.ulid, draft.item.id, body, draft.key);
      client.setQueryData(tableKeys.tab(tab.ulid), next);
      void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
      const printed = await printTabVoid(next, draft.item, body.qty, draft.key);
      setPrint(printed);
      reset();
    } catch (error) {
      failure = error;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
    if (failure === null) return;

    if (isTabConflict(failure)) {
      reset();
      onConflict(failure.message);
      return;
    }
    const classified = classifyReversalError(failure);
    switch (classified.kind) {
      case 'unconfirmed':
        setAwaiting(true);
        setBanner({ message: CANCEL_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true });
        return;
      case 'inFlight':
        setAwaiting(true);
        setBanner({ message: classified.message, variant: 'info', retry: true });
        return;
      case 'approvalRequired':
        setAwaiting(false);
        setApprovalAsked(true);
        picker.open(classified.message);
        return;
      case 'approverRejected':
        setAwaiting(false);
        picker.rejectApprover(classified.message);
        return;
      case 'wrongPin':
        setAwaiting(false);
        picker.wrongPin(classified.message);
        return;
      case 'pinLocked':
        setAwaiting(false);
        if (body.authorization) picker.showError(classified.message);
        else setBanner({ message: classified.message, variant: 'error', retry: false });
        return;
      case 'invalid':
        setAwaiting(false);
        if (classified.fields.reason) setReasonError(classified.fields.reason);
        else setBanner({ message: classified.message, variant: 'error', retry: false });
        return;
      default:
        setAwaiting(false);
        setBanner({ message: classified.message, variant: 'error', retry: false });
    }
  }

  function confirm() {
    if (!draft) return;
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
    void send({ qty: draft.qty, reason, authorization });
  }

  return {
    draft,
    needsApproval,
    picker,
    choice,
    otherText,
    reasonError,
    banner,
    submitting,
    awaiting,
    locked,
    /** The last cancel's VOID ticket result (shown on the tab). */
    print,
    dismissPrint: () => setPrint(null),
    canConfirm: !submitting && (awaiting || (reason !== '' && approvalReady)),
    request: (item: TabItem) => {
      reset();
      setPrint(null);
      setDraft({ item, qty: 1, key: makeUlid() });
      if (!ownAuthority) picker.open(null);
    },
    close: () => {
      if (inFlight.current) return;
      reset();
    },
    setQty: (qty: number) => {
      if (locked) return;
      setDraft((current) => (current ? { ...current, qty } : current));
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

export type TabItemCancelState = ReturnType<typeof useTabItemCancel>;
