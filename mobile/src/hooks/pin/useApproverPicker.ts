import { useState } from 'react';

import { usePinUsers } from '@/hooks/pin/usePinUsers';
import type { PinUser, ReversalAuthorization } from '@/services/types';
import { isPinComplete } from '@/utils/pin';

/** The approver picker and PIN pad, as the approval UI shows them (the same shape checkout uses). */
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

export const CLOSED_APPROVAL: ApprovalState = { visible: false, step: 'pick', approver: null, pin: '', error: null, reason: null };

/**
 * A manager's PIN approval on the same screen (Voids & Refunds, Phase 7:
 * "exactly like discount approval"): the people from `GET /auth/pin-users`
 * that `canApprove` keeps (`can_approve_voids` / `can_approve_refunds`, UI
 * hints: the server checks), then their PIN. Loads `pin-users` only while
 * the picker is shown. The state lives in the caller's screen hook, above any
 * layout switch, so rotating keeps it.
 */
export function useApproverPicker(canApprove: (person: PinUser) => boolean) {
  const [approval, setApproval] = useState<ApprovalState>(CLOSED_APPROVAL);
  const pinUsers = usePinUsers(approval.visible);
  const approvers = pinUsers.items.filter(canApprove);

  return {
    approval,
    approvers,
    approversLoading: pinUsers.grid.loading,
    approversError: pinUsers.grid.error as unknown,
    retryApprovers: pinUsers.grid.onRetry,
    /** Shows the picker (from the start), with the server's reason when it asked. */
    open: (reason: string | null = null) => setApproval({ ...CLOSED_APPROVAL, visible: true, reason }),
    close: () => setApproval(CLOSED_APPROVAL),
    chooseApprover: (person: PinUser) => setApproval((current) => ({ ...current, step: 'pin', approver: person, pin: '', error: null })),
    backToApprovers: () => setApproval((current) => ({ ...current, step: 'pick', approver: null, pin: '', error: null })),
    setApprovalPin: (pin: string) => setApproval((current) => ({ ...current, pin, error: null })),
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
  };
}

export type ApproverPicker = ReturnType<typeof useApproverPicker>;
