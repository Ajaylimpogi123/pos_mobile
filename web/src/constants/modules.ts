/**
 * Every module of the web app, defined once (MASTER §2.1, Web POS §F): the
 * sidebar and the route guards both read this list; nothing is hardcoded in
 * the sidebar.
 *
 * - `permissions`: the user needs **any** of these slugs (`null`: any signed-in
 *   user). A module the user can't use is hidden. The server stays the authority.
 * - `ready: false` modules belong to later build rounds (Web POS §G): they show
 *   as a disabled "Soon" item, with no page behind them.
 */
import {
  Boxes,
  Bug,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Armchair,
  Clock,
  LayoutDashboard,
  LayoutGrid,
  Printer,
  ReceiptText,
  Ruler,
  ShieldCheck,
  ShoppingCart,
  TabletSmartphone,
  Truck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

import { PERMISSIONS, type PermissionSlug } from '@/utils/permissions';

export type ModuleKey =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'review'
  | 'shifts'
  | 'products'
  | 'categories'
  | 'ingredients'
  | 'units'
  | 'inventory'
  | 'purchasing'
  | 'suppliers'
  | 'customers'
  | 'staff'
  | 'roles'
  | 'reports'
  | 'printers'
  | 'tables'
  | 'devices'
  | 'errorLog';

export type ModuleGroup = 'main' | 'catalogue' | 'stock' | 'people' | 'settings';

export type AppModule = {
  key: ModuleKey;
  label: string;
  icon: LucideIcon;
  /** The route under the `/pos` basename. */
  path: string;
  permissions: readonly PermissionSlug[] | null;
  group: ModuleGroup;
  /** Built in this round; `false` shows a disabled "Soon" item. */
  ready: boolean;
  /** A count shown on the item (e.g. the orders that need review). */
  badge?: ModuleBadge;
  /** A branch setting the item needs to show in the sidebar (the route still works, e.g. from Settings). */
  requires?: ModuleRequirement;
};

/** Dine-in Tables & Tabs §I: Admin → Tables shows in the sidebar only while dine-in is on. */
export type ModuleRequirement = 'dine_in';

/** The counts a sidebar item can show (`components/shell/ModuleBadge.tsx` reads them). */
export type ModuleBadge = 'needs_review';

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string | null> = {
  main: null,
  catalogue: 'Catalogue',
  stock: 'Stock',
  people: 'People & reports',
  settings: 'Settings',
};

const PURCHASING_READ: readonly PermissionSlug[] = [
  PERMISSIONS.purchaseRequest,
  PERMISSIONS.purchaseApprove,
  PERMISSIONS.purchaseApproveOwn,
  PERMISSIONS.purchaseReceive,
  PERMISSIONS.supplierManage,
  PERMISSIONS.reportView,
];

const USER_MANAGE: readonly PermissionSlug[] = [PERMISSIONS.userManage];

const INGREDIENTS_READ: readonly PermissionSlug[] = [PERMISSIONS.productManage, PERMISSIONS.inventoryAdjust, ...PURCHASING_READ];

/** Sidebar order (MASTER §6 Navigation): the groups and the order inside each group. */
export const MODULES: readonly AppModule[] = [
  // (no heading)
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', permissions: null, group: 'main', ready: true },
  { key: 'pos', label: 'POS', icon: ShoppingCart, path: '/sell', permissions: [PERMISSIONS.saleCreate], group: 'main', ready: true },
  {
    key: 'orders',
    label: 'Order History',
    icon: ReceiptText,
    path: '/orders',
    permissions: [PERMISSIONS.saleCreate, PERMISSIONS.reportView],
    group: 'main',
    ready: true,
  },
  {
    // Offline Sales → Review: Order History filtered to the flagged sales.
    key: 'review',
    label: 'Needs review',
    icon: ClipboardCheck,
    path: '/orders/review',
    permissions: [PERMISSIONS.orderReview],
    group: 'main',
    ready: true,
    badge: 'needs_review',
  },
  {
    key: 'shifts',
    label: 'Shifts',
    icon: Clock,
    path: '/shifts',
    permissions: [PERMISSIONS.shiftOpen, PERMISSIONS.shiftClose, PERMISSIONS.reportZread],
    group: 'main',
    ready: true,
  },
  // Table Management §A: always in the sidebar for settings.manage or report.view (Board, Reservations, Floor plan, List by permission).
  {
    key: 'tables',
    label: 'Tables',
    icon: Armchair,
    path: '/tables',
    permissions: [PERMISSIONS.settingsManage, PERMISSIONS.reportView],
    group: 'main',
    ready: true,
  },

  // Catalogue
  {
    key: 'products',
    label: 'Products',
    icon: UtensilsCrossed,
    path: '/products',
    permissions: [PERMISSIONS.productManage],
    group: 'catalogue',
    ready: true,
  },
  {
    key: 'categories',
    label: 'Categories',
    icon: LayoutGrid,
    path: '/categories',
    permissions: [PERMISSIONS.productManage],
    group: 'catalogue',
    ready: true,
  },
  { key: 'ingredients', label: 'Ingredients', icon: Wheat, path: '/ingredients', permissions: INGREDIENTS_READ, group: 'catalogue', ready: true },
  // The read-only unit catalog (same access as Ingredients).
  { key: 'units', label: 'Units', icon: Ruler, path: '/ingredients/units', permissions: INGREDIENTS_READ, group: 'catalogue', ready: true },

  // Stock
  {
    key: 'inventory',
    label: 'Inventory',
    icon: Boxes,
    path: '/inventory',
    permissions: [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView],
    group: 'stock',
    ready: true,
  },
  { key: 'purchasing', label: 'Purchasing', icon: ClipboardList, path: '/purchasing', permissions: PURCHASING_READ, group: 'stock', ready: true },
  {
    key: 'suppliers',
    label: 'Suppliers',
    icon: Truck,
    path: '/suppliers',
    permissions: [
      PERMISSIONS.supplierManage,
      PERMISSIONS.purchaseRequest,
      PERMISSIONS.purchaseApprove,
      PERMISSIONS.purchaseApproveOwn,
      PERMISSIONS.purchaseReceive,
    ],
    group: 'stock',
    ready: true,
  },

  // People & reports
  {
    key: 'customers',
    label: 'Customers',
    icon: Users,
    path: '/customers',
    permissions: [PERMISSIONS.saleCreate, PERMISSIONS.customerManage],
    group: 'people',
    ready: true,
  },
  { key: 'staff', label: 'Staff', icon: UserRound, path: '/staff', permissions: USER_MANAGE, group: 'people', ready: true },
  // The read-only roles (same access as Staff).
  { key: 'roles', label: 'Roles', icon: ShieldCheck, path: '/staff/roles', permissions: USER_MANAGE, group: 'people', ready: true },
  {
    // Sales and Inventory need `report.view`; Purchasing `report.view` or `purchase.approve` (§I).
    key: 'reports',
    label: 'Reports',
    icon: ChartColumn,
    path: '/reports',
    permissions: [PERMISSIONS.reportView, PERMISSIONS.purchaseApprove],
    group: 'people',
    ready: true,
  },

  // Settings
  {
    key: 'printers',
    label: 'Printers & settings',
    icon: Printer,
    path: '/printers',
    permissions: [PERMISSIONS.settingsManage],
    group: 'settings',
    ready: true,
  },
  // Hardening & Pilot §E: admin Devices and the Error log (`system.manage`).
  {
    key: 'devices',
    label: 'Devices',
    icon: TabletSmartphone,
    path: '/settings/devices',
    permissions: [PERMISSIONS.systemManage],
    group: 'settings',
    ready: true,
  },
  { key: 'errorLog', label: 'Error log', icon: Bug, path: '/settings/error-log', permissions: [PERMISSIONS.systemManage], group: 'settings', ready: true },
];

export function moduleByKey(key: ModuleKey): AppModule {
  const found = MODULES.find((module) => module.key === key);
  if (!found) throw new Error(`Unknown module ${key}`);
  return found;
}
