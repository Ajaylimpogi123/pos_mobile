/**
 * Purchasing permissions (§E) as UI hints (the server enforces every rule,
 * including self-approval), the query keys, and the refresh after any
 * purchasing write. Mirrors the tablet's `mobile/src/hooks/purchasing/usePurchasingPermissions.ts`.
 */
import { useQueryClient } from '@tanstack/react-query';

import { ingredientStockRoot } from '@/hooks/useIngredients';
import { inventoryKeys } from '@/hooks/useInventory';
import { stockKey } from '@/hooks/useStockBadges';
import type { PurchaseOrderListParams, PurchaseRequestListParams } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS, PURCHASING_READ_PERMISSIONS } from '@/utils/permissions';

export const purchaseRequestKeys = {
  all: ['purchase-requests'] as const,
  lists: ['purchase-requests', 'list'] as const,
  list: (params: PurchaseRequestListParams) => ['purchase-requests', 'list', params] as const,
  detail: (ulid: string) => ['purchase-requests', 'detail', ulid] as const,
};

export const purchaseOrderKeys = {
  all: ['purchase-orders'] as const,
  lists: ['purchase-orders', 'list'] as const,
  list: (params: PurchaseOrderListParams) => ['purchase-orders', 'list', params] as const,
  detail: (ulid: string) => ['purchase-orders', 'detail', ulid] as const,
};

/** PRs and POs per page. */
export const PURCHASE_PAGE_SIZE = 25;

/**
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

/** After any purchasing write: the PR and PO lists refresh, and (a receipt) the stock screens too. */
export function useAfterPurchasingWrite() {
  const client = useQueryClient();
  return (options: { stock?: boolean } = {}) => {
    void client.invalidateQueries({ queryKey: purchaseRequestKeys.lists });
    void client.invalidateQueries({ queryKey: purchaseOrderKeys.lists });
    if (options.stock) {
      void client.invalidateQueries({ queryKey: ingredientStockRoot });
      void client.invalidateQueries({ queryKey: ['admin', 'ingredients'] });
      void client.invalidateQueries({ queryKey: inventoryKeys.all });
      void client.invalidateQueries({ queryKey: stockKey });
    }
  };
}
