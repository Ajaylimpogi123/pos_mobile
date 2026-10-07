import type { AuthUser } from '@/services/types';

/** Permission slugs the app checks (contract: Roles & permissions). UI hints only: the server enforces them. */
export const PERMISSIONS = {
  productManage: 'product.manage',
  userManage: 'user.manage',
  saleCreate: 'sale.create',
  customerManage: 'customer.manage',
  reportView: 'report.view',
  discountApply: 'discount.apply',
  discountOverride: 'discount.override',
  inventoryAdjust: 'inventory.adjust',
  settingsManage: 'settings.manage',
  /** Offline Sales (Phase 5): review flagged offline sales (Owner and Manager). */
  orderReview: 'order.review',
  /** Shifts & Reporting (Phase 6): open a shift, cash in and out, the X-read. */
  shiftOpen: 'shift.open',
  /** Phase 6: close the shift (prints the Z-read). */
  shiftClose: 'shift.close',
  /** Phase 6: the Shifts list and every shift's report. */
  reportZread: 'report.zread',
  /** Voids & Refunds (Phase 7): void on one's own authority (otherwise a manager approves by PIN). */
  saleVoid: 'sale.void',
  /** Phase 7: refund on one's own authority (otherwise a manager approves by PIN). */
  saleRefund: 'sale.refund',
  /** Ingredients, Recipes & Purchasing §E: create or edit purchase requests. */
  purchaseRequest: 'purchase.request',
  /** §E: decide PR items; approve or decline POs (Owner and Manager). */
  purchaseApprove: 'purchase.approve',
  /** §E: decide or approve a PR / PO you created yourself (Owner only). */
  purchaseApproveOwn: 'purchase.approve_own',
  /** §E: record receipts. */
  purchaseReceive: 'purchase.receive',
  /** §E: manage suppliers. */
  supplierManage: 'supplier.manage',
} as const;

/** §E: "any purchase permission" (with `report.view`, the purchasing reads). */
export const PURCHASE_PERMISSIONS = [
  PERMISSIONS.purchaseRequest,
  PERMISSIONS.purchaseApprove,
  PERMISSIONS.purchaseApproveOwn,
  PERMISSIONS.purchaseReceive,
  PERMISSIONS.supplierManage,
] as const;

/** §E: who may read the PR, PO and receiving lists and details: any purchase permission, or `report.view`. */
export const PURCHASING_READ_PERMISSIONS = [...PURCHASE_PERMISSIONS, PERMISSIONS.reportView] as const;

export type PermissionSlug = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** True when the signed-in user's `permissions` include `slug`. */
export function hasPermission(user: AuthUser | null | undefined, slug: PermissionSlug): boolean {
  return Boolean(user?.permissions.includes(slug));
}

/** True when the user holds at least one of `slugs` (e.g. Orders: `sale.create` or `report.view`). */
export function hasAnyPermission(user: AuthUser | null | undefined, slugs: readonly PermissionSlug[]): boolean {
  return slugs.some((slug) => hasPermission(user, slug));
}
