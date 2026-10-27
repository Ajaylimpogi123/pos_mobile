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
  | 'products'
  | 'categories'
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
  | 'tables'
  | 'device'
  | 'devices'
  | 'error_log'
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
  /** Shown only while a branch feature is on (Dine-in Tables & Tabs: `dine_in`). */
  requires?: 'dine_in';
};

/** Branch features that show or hide modules (from the cached print-config settings). */
export type ModuleFeatures = { dineIn: boolean };

export type ModuleGroup = {
  key: 'main' | 'catalogue' | 'stock' | 'people' | 'settings';
  /** The group heading (MASTER §6); empty for the first group, which has none. */
  label: string;
  modules: readonly ModuleDefinition[];
};

export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    // MASTER §6: the first group has no heading. Tables is always listed (Table Management §A).
    key: 'main',
    label: '',
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
        label: 'POS',
        icon: 'cart-outline',
        activeIcon: 'cart',
        status: 'ready',
        route: ROUTES.sell,
        permission: null,
      },
      {
        // Phase 3: order history. Without `report.view` the server shows only the user's own sales.
        key: 'orders',
        label: 'Order History',
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
      {
        // Table Management §A: always in the menu (dine-in on or off) for managers and the board.
        key: 'tables',
        label: 'Tables',
        icon: 'restaurant-outline',
        activeIcon: 'restaurant',
        status: 'ready',
        route: ROUTES.tables,
        permission: [PERMISSIONS.settingsManage, PERMISSIONS.reportView],
      },
    ],
  },
  {
    key: 'catalogue',
    label: 'Catalogue',
    modules: [
      {
        // MASTER §6: Products and Categories are separate items (the Products / Categories switch stays in the menu header).
        key: 'products',
        label: 'Products',
        icon: 'fast-food-outline',
        activeIcon: 'fast-food',
        status: 'ready',
        route: ROUTES.menuProducts,
        permission: PERMISSIONS.productManage,
      },
      {
        key: 'categories',
        label: 'Categories',
        icon: 'albums-outline',
        activeIcon: 'albums',
        status: 'ready',
        route: ROUTES.menuCategories,
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
    ],
  },
  {
    // Inventory, then Purchasing (PR → PO → receiving) and the suppliers.
    key: 'stock',
    label: 'Stock',
    modules: [
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
    label: 'People & reports',
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
    key: 'settings',
    label: 'Settings',
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
        // Hardening & Pilot §E: the setup and health screen of this tablet, for every signed-in user.
        key: 'device',
        label: 'This tablet',
        icon: 'tablet-landscape-outline',
        activeIcon: 'tablet-landscape',
        status: 'ready',
        route: ROUTES.device,
        permission: null,
      },
      {
        // §E: every tablet and web terminal of the branch: health, rename, retire, restore.
        key: 'devices',
        label: 'Devices',
        icon: 'hardware-chip-outline',
        activeIcon: 'hardware-chip',
        status: 'ready',
        route: ROUTES.devices,
        permission: PERMISSIONS.systemManage,
      },
      {
        // §E: app and server errors, grouped, with resolve / reopen.
        key: 'error_log',
        label: 'Error log',
        icon: 'bug-outline',
        activeIcon: 'bug',
        status: 'ready',
        route: ROUTES.errorLog,
        permission: PERMISSIONS.systemManage,
      },
      {
        // Phase 5: the Sync queue of the offline sales saved on this tablet (also opened from the Sell status pill).
        key: 'sync',
        label: 'Sync queue',
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

/** The groups and modules this user may see (empty groups are dropped); feature modules only while their feature is on. */
export function visibleModuleGroups(user: AuthUser | null, features: ModuleFeatures = { dineIn: false }): ModuleGroup[] {
  return MODULE_GROUPS.map((group) => ({
    ...group,
    modules: group.modules.filter(
      (module) => canSeeModule(user, module) && (module.requires !== 'dine_in' || features.dineIn),
    ),
  })).filter((group) => group.modules.length > 0);
}

/** URL prefixes of each `ready` module (group segments don't appear in URLs). */
const MODULE_PATHS: readonly (readonly [ModuleKey, string])[] = [
  ['sell', '/sell'],
  // Dine-in: a tab is part of Sell.
  ['sell', '/tabs'],
  ['tables', '/tables'],
  ['orders', '/orders'],
  ['products', '/menu/products'],
  ['categories', '/menu/categories'],
  ['customers', '/customers'],
  ['staff', '/staff'],
  ['printers', '/printers'],
  ['settings', '/settings'],
  ['device', '/device'],
  ['devices', '/devices'],
  ['error_log', '/error-log'],
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
