/**
 * A manager's PIN approval on the same dialog (Voids & Refunds, Phase 7:
 * "exactly like discount approval", as W1's checkout does it): the people from
 * `GET /auth/pin-users` that `canApprove` keeps (`can_approve_voids` /
 * `can_approve_refunds`, UI hints: the server checks), then their PIN.
 * `pin-users` loads only while the picker is shown. The PIN is never stored.
 */
import { useState } from 'react';

import { isPinComplete } from '@/hooks/sell/useCheckout';
import { useCursorList } from '@/hooks/useCursorList';
import { listPinUsers } from '@/services/auth';
import type { PinUser, ReversalAuthorization } from '@/services/types';

export type ApproverState = {
  visible: boolean;
  step: 'pick' | 'pin';
  approver: PinUser | null;
  pin: string;
  /** Under the picker or the PIN field (wrong PIN, can't approve, locked PIN). */
  error: string | null;
  /** Why approval is asked for (the server's message, when it asked). */
  reason: string | null;
};

const CLOSED: ApproverState = { visible: false, step: 'pick', approver: null, pin: '', error: null, reason: null };

export function useApproverPicker(canApprove: (person: PinUser) => boolean) {
  const [approval, setApproval] = useState<ApproverState>(CLOSED);
  const pinUsers = useCursorList(['auth', 'pin-users'], (cursor) => listPinUsers({ cursor, per_page: 100 }), {
    enabled: approval.visible,
  });
  const approvers = pinUsers.items.filter(canApprove);

  return {
    approval,
    approvers,
    approversLoading: pinUsers.loading,
    approversError: pinUsers.error,
    retryApprovers: pinUsers.retry,
    /** Shows the picker (from the start), with the server's reason when it asked. */
    open: (reason: string | null = null) => setApproval({ ...CLOSED, visible: true, reason }),
    close: () => setApproval(CLOSED),
    chooseApprover: (person: PinUser) => setApproval((current) => ({ ...current, step: 'pin', approver: person, pin: '', error: null })),
    backToApprovers: () => setApproval((current) => ({ ...current, step: 'pick', approver: null, pin: '', error: null })),
    setPin: (pin: string) => setApproval((current) => ({ ...current, pin: pin.replace(/\D/g, '').slice(0, 6), error: null })),
    /** `422` on `authorization.user_id`: pick someone else. */
    rejectApprover: (message: string) =>
      setApproval((current) => ({ ...current, visible: true, step: 'pick', approver: null, pin: '', error: message })),
    /** `422` on `authorization.pin`: the PIN again. */
    wrongPin: (message: string) => setApproval((current) => ({ ...current, visible: true, step: 'pin', pin: '', error: message })),
    /** `429` (the approver's PIN is locked): shown on the step the user is on. */
    showError: (message: string) => setApproval((current) => ({ ...current, visible: true, pin: '', error: message })),
    /** The approval to send, once an approver and a complete PIN are chosen. */
    authorization: (): ReversalAuthorization | null =>
      approval.approver && isPinComplete(approval.pin) ? { user_id: approval.approver.id, pin: approval.pin } : null,
    /** An approver is chosen and the PIN is complete. */
    ready: approval.approver !== null && isPinComplete(approval.pin),
  };
}

export type ApproverPicker = ReturnType<typeof useApproverPicker>;
