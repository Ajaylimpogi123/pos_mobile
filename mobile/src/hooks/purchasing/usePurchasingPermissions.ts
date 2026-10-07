import { useQueryClient } from '@tanstack/react-query';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { inventoryKeys } from '@/hooks/inventory/queryKeys';
import { ingredientStockKeys, purchaseOrderKeys, purchaseRequestKeys } from '@/hooks/purchasing/queryKeys';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS, PURCHASING_READ_PERMISSIONS } from '@/utils/permissions';

/**
 * §E as UI hints (the server enforces every rule, including self-approval):
 * - `canRead`: any purchase permission or `report.view`;
 * - `canRequest`: create / edit PRs; `canApprove`: decide PR items, approve or
 *   decline POs; `canApproveOwn`: do so on your own PR / PO; `canReceive`.
 */
export function usePurchasingPermissions() {
  const user = useSessionStore((state) => state.user);
  return {
    userId: user?.id ?? null,
    canRead: hasAnyPermission(user, PURCHASING_READ_PERMISSIONS),
    canRequest: hasPermission(user, PERMISSIONS.purchaseRequest),
    canApprove: hasPermission(user, PERMISSIONS.purchaseApprove),
    canApproveOwn: hasPermission(user, PERMISSIONS.purchaseApproveOwn),
    canReceive: hasPermission(user, PERMISSIONS.purchaseReceive),
    canManageSuppliers: hasPermission(user, PERMISSIONS.supplierManage),
  };
}

export type PurchasingPermissions = ReturnType<typeof usePurchasingPermissions>;

/**
 * After any purchasing write: the PR and PO lists refresh, and (a receipt)
 * the stock screens and dashboard insights too.
 */
export function useAfterPurchasingWrite() {
  const client = useQueryClient();
  return (options: { stock?: boolean } = {}) => {
    void client.invalidateQueries({ queryKey: purchaseRequestKeys.lists() });
    void client.invalidateQueries({ queryKey: purchaseOrderKeys.lists() });
    void client.invalidateQueries({ queryKey: dashboardKeys.dashboard });
    if (options.stock) {
      void client.invalidateQueries({ queryKey: ingredientStockKeys.all });
      void client.invalidateQueries({ queryKey: inventoryKeys.all });
    }
  };
}
