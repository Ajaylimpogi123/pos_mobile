import { useCurrentShift } from '@/hooks/shifts/useCurrentShift';
import { useCanReachServer } from '@/hooks/useIsOnline';
import { reversalGate, type ReversalGate } from '@pos/core/sale/reversals';
import type { PrintableOrder } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * Which of **Void sale** and **Refund** the order detail shows, and whether
 * they can run now (docs/api-contract.md → Voids & Refunds → Device rules →
 * Where the actions are): from the order, this tablet's open shift, the
 * connection (device connected and the server reachable) and the user's
 * permissions. See `reversalGate` for the rules.
 */
export function useReversalGate(order: PrintableOrder, unsynced: boolean): ReversalGate {
  const user = useSessionStore((state) => state.user);
  const online = useCanReachServer();
  const shift = useCurrentShift();
  return reversalGate({
    order,
    // A sale saved on this tablet without an invoice number hasn't reached the server.
    unsynced: unsynced || order.invoice_no === null,
    online,
    currentShiftUlid: shift.shift?.ulid ?? null,
    shiftLoading: shift.loading,
    canVoid: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleVoid]),
    canRefund: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleRefund]),
  });
}
