import { useCursorList } from '@/hooks/useCursorList';
import { listPinUsers } from '@/services/auth';

/** TanStack Query keys of the PIN quick-switch. */
export const pinUserKeys = {
  all: ['auth', 'pin-users'] as const,
};

/**
 * GET /api/v1/auth/pin-users, every page: the people who can sign in with a
 * PIN on this device (the switch-user grid) and the candidate discount
 * approvers (filtered by `can_approve_discounts` and `max_discount_percent`).
 */
export function usePinUsers(enabled = true) {
  return useCursorList({
    queryKey: pinUserKeys.all,
    fetchPage: (cursor) => listPinUsers({ cursor }),
    fetchAll: true,
    enabled,
  });
}
