import type { Href } from 'expo-router';

import type { IconName } from '@/components/ui/Icon';
import { ROUTES } from '@/constants/routes';
import type { AuthUser } from '@/services/types';
import {
  hasAnyPermission,
  PURCHASE_PERMISSIONS,
  PURCHASING_READ_PERMISSIONS,
  type PermissionSlug,
  PERMISSIONS,
} from '@/utils/permissions';

/**
 * Every system module in the app-shell sidebar, in one place.
 * - `ready` modules navigate to `route`.
 * - `soon` modules are listed (so staff can see what is coming) but are
 *   disabled, with a "Soon" tag. They have no route yet.
 * - `permission`: the module is hidden from users without it (a list means
 *   any one of them). A UI hint only: the API enforces every permission itself (403).
 */
export type ModuleKey =
  | 'dashboard'
  | 'sell'
  | 'orders'
  | 'shifts'
  | 'menu'
  | 'ingredients'
  | 'inventory'
  | 'purchase_requests'
  | 'purchase_orders'
  | 'receiving'
  | 'suppliers'
  | 'customers'
  | 'staff'
  | 'reports'
  | 'printers'
  | 'settings'
  | 'sync';

export type ModuleStatus = 'ready' | 'soon';

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  icon: IconName;
  /** Icon of the active item (usually the filled glyph). */
  activeIcon: IconName;
  status: ModuleStatus;
  /** Where a `ready` module goes. */
  route: Href | null;
  /** Hidden without this permission, or without any of these (`null`: every signed-in user). */
  permission: PermissionSlug | readonly PermissionSlug[] | null;
  /** Extra screen-reader context, e.g. when a `soon` module arrives. */
  hint?: string;
};

export type ModuleGroup = {
  key: 'main' | 'catalogue' | 'purchasing' | 'people' | 'insights' | 'system';
  label: string;
  modules: readonly ModuleDefinition[];
};

export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    key: 'main',
    label: 'Main',
    modules: [
      {
        key: 'dashboard',
        label: 'Dashboard',
        icon: 'grid-outline',
        activeIcon: 'grid',
        status: 'ready',
        route: ROUTES.dashboard,
        permission: null,
      },
      {
        // The on-device menu for everyone; users with `sale.create` also get the cart and checkout (Phase 3).
        key: 'sell',
        label: 'Sell / POS',
        icon: 'cart-outline',
        activeIcon: 'cart',
        status: 'ready',
        route: ROUTES.sell,
        permission: null,
      },
      {
        // Phase 3: order history. Without `report.view` the server shows only the user's own sales.
        key: 'orders',
        label: 'Orders',
        icon: 'receipt-outline',
        activeIcon: 'receipt',
        status: 'ready',
        route: ROUTES.orders,
        permission: [PERMISSIONS.saleCreate, PERMISSIONS.reportView],
      },
      {
        // Phase 6: every shift's report from the server (the shift itself is run from Sell).
        key: 'shifts',
        label: 'Shifts',
        icon: 'time-outline',
        activeIcon: 'time',
        status: 'ready',
        route: ROUTES.shifts,
        permission: PERMISSIONS.reportZread,
      },
    ],
  },
  {
    key: 'catalogue',
    label: 'Catalogue',
    modules: [
      {
        // One item: opens Products; the Products / Categories switch lives in the menu header.
        key: 'menu',
        label: 'Menu',
        icon: 'restaurant-outline',
        activeIcon: 'restaurant',
        status: 'ready',
        route: ROUTES.menuProducts,
        permission: PERMISSIONS.productManage,
      },
      {
        // Ingredients, Recipes & Purchasing §D: ingredients with a base unit, their own units and a photo.
        key: 'ingredients',
        label: 'Ingredients',
        icon: 'nutrition-outline',
        activeIcon: 'nutrition',
        status: 'ready',
        route: ROUTES.ingredients,
        permission: PERMISSIONS.productManage,
      },
      {
        // Inventory (v1 completion): the stock list, each product's history, stock in / count / wastage, reorder levels.
        // A `Products | Ingredients` switch (Ingredients, Recipes & Purchasing §L).
        key: 'inventory',
        label: 'Inventory',
        icon: 'cube-outline',
        activeIcon: 'cube',
        status: 'ready',
        route: ROUTES.inventory,
        permission: [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView],
      },
    ],
  },
  {
    // Ingredients, Recipes & Purchasing §L: PR → PO → receiving, and the suppliers.
    key: 'purchasing',
    label: 'Purchasing',
    modules: [
      {
        key: 'purchase_requests',
        label: 'Purchase requests',
        icon: 'document-text-outline',
        activeIcon: 'document-text',
        status: 'ready',
        route: ROUTES.purchaseRequests,
        permission: PURCHASING_READ_PERMISSIONS,
      },
      {
        key: 'purchase_orders',
        label: 'Purchase orders',
        icon: 'clipboard-outline',
        activeIcon: 'clipboard',
        status: 'ready',
        route: ROUTES.purchaseOrders,
        permission: PURCHASING_READ_PERMISSIONS,
      },
      {
        key: 'receiving',
        label: 'Receiving',
        icon: 'download-outline',
        activeIcon: 'download',
        status: 'ready',
        route: ROUTES.receiving,
        permission: PERMISSIONS.purchaseReceive,
      },
      {
        // Read with any purchase permission; create, edit and delete with `supplier.manage`.
        key: 'suppliers',
        label: 'Suppliers',
        icon: 'business-outline',
        activeIcon: 'business',
        status: 'ready',
        route: ROUTES.suppliers,
        permission: PURCHASE_PERMISSIONS,
      },
    ],
  },
  {
    key: 'people',
    label: 'People',
    modules: [
      {
        key: 'customers',
        label: 'Customers',
        icon: 'person-circle-outline',
        activeIcon: 'person-circle',
        status: 'ready',
        route: ROUTES.customers,
        permission: null,
      },
      {
        key: 'staff',
        label: 'Staff',
        icon: 'people-outline',
        activeIcon: 'people',
        status: 'ready',
        route: ROUTES.staff,
        permission: PERMISSIONS.userManage,
      },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    modules: [
      {
        // Phase 6: sales reports by day, product, category, payment or cashier, with CSV export.
        // Ingredients, Recipes & Purchasing §I: the Purchasing view is also open to `purchase.approve`.
        key: 'reports',
        label: 'Reports',
        icon: 'bar-chart-outline',
        activeIcon: 'bar-chart',
        status: 'ready',
        route: ROUTES.reports,
        permission: [PERMISSIONS.reportView, PERMISSIONS.purchaseApprove],
      },
    ],
  },
  {
    key: 'system',
    label: 'System',
    modules: [
      {
        // Phase 4: the list works offline from the cached print config; create and edit need `settings.manage`.
        key: 'printers',
        label: 'Printers',
        icon: 'print-outline',
        activeIcon: 'print',
        status: 'ready',
        route: ROUTES.printers,
        permission: [PERMISSIONS.saleCreate, PERMISSIONS.settingsManage],
      },
      {
        // Phase 4: receipt settings.
        key: 'settings',
        label: 'Settings',
        icon: 'settings-outline',
        activeIcon: 'settings',
        status: 'ready',
        route: ROUTES.settings,
        permission: PERMISSIONS.settingsManage,
      },
      {
        // Phase 5: the Sync queue of the offline sales saved on this tablet (also opened from the Sell status pill).
        key: 'sync',
        label: 'Sync',
        icon: 'sync-outline',
        activeIcon: 'sync',
        status: 'ready',
        route: ROUTES.syncQueue,
        permission: PERMISSIONS.saleCreate,
      },
    ],
  },
];

/** Whether the user may see a module (`permission` null, held, or any one of a list held). */
export function canSeeModule(user: AuthUser | null, module: Pick<ModuleDefinition, 'permission'>): boolean {
  if (module.permission === null) return true;
  const slugs: readonly PermissionSlug[] = typeof module.permission === 'string' ? [module.permission] : module.permission;
  return hasAnyPermission(user, slugs);
}

/** The groups and modules this user may see (empty groups are dropped). */
export function visibleModuleGroups(user: AuthUser | null): ModuleGroup[] {
  return MODULE_GROUPS.map((group) => ({
    ...group,
    modules: group.modules.filter((module) => canSeeModule(user, module)),
  })).filter((group) => group.modules.length > 0);
}

/** URL prefixes of each `ready` module (group segments don't appear in URLs). */
const MODULE_PATHS: readonly (readonly [ModuleKey, string])[] = [
  ['sell', '/sell'],
  ['orders', '/orders'],
  ['menu', '/menu'],
  ['customers', '/customers'],
  ['staff', '/staff'],
  ['printers', '/printers'],
  ['settings', '/settings'],
  ['sync', '/sync-queue'],
  ['shifts', '/shifts'],
  ['reports', '/reports'],
  ['inventory', '/inventory'],
  ['ingredients', '/ingredients'],
  ['purchase_requests', '/purchasing/requests'],
  ['purchase_orders', '/purchasing/orders'],
  ['receiving', '/purchasing/receiving'],
  ['suppliers', '/purchasing/suppliers'],
];

/** The module the current pathname belongs to (`/` and anything unknown → the dashboard). */
export function activeModuleKey(pathname: string): ModuleKey {
  const match = MODULE_PATHS.find(([, prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[0] : 'dashboard';
}
