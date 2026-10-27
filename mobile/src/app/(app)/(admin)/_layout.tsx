import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS, PURCHASING_READ_PERMISSIONS } from '@/utils/permissions';

/**
 * Admin area. `(app)/_layout.tsx` mounts this group for signed-in users holding
 * `product.manage`, `user.manage`, `settings.manage` or `sale.create`; each
 * section is then gated on its own permission with `Stack.Protected` (Expo
 * Router protected routes):
 * - `menu/…`  needs `product.manage`
 * - `ingredients/…` needs `product.manage` (Ingredients, Recipes & Purchasing)
 * - `staff/…` needs `user.manage`
 * - `printers/…` needs `sale.create` or `settings.manage` (its layout gates `new` and `[id]` on `settings.manage`)
 * - `settings/index` needs `settings.manage`
 * - `tables/index` needs `settings.manage`, `report.view` or `sale.create` (Table Management §A: its tabs are
 *   each gated by permission; a cashier reaches Reservations from Sell → Tables)
 * - `shifts/…` needs `report.zread` (Phase 6)
 * - `reports/index` needs `report.view` (Phase 6), or `purchase.approve` (its Purchasing view)
 * - `inventory/…` needs `inventory.adjust` or `report.view` (Inventory, v1 completion)
 * - `purchasing/…` needs any purchase permission or `report.view` (its layout gates each section)
 * - `devices/…` and `error-log/…` need `system.manage` (Hardening & Pilot §E)
 * These are UI hints: the API still answers 403, which every admin screen
 * shows as an ErrorState ("No access") or a banner.
 */
export default function AdminLayout() {
  const canManageMenu = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.productManage));
  const canManageStaff = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.userManage));
  const canViewPrinters = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.saleCreate, PERMISSIONS.settingsManage]),
  );
  const canManageSettings = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.settingsManage));
  const canViewTables = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.settingsManage, PERMISSIONS.reportView, PERMISSIONS.saleCreate]),
  );
  const canViewShifts = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.reportZread));
  const canViewReports = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.reportView, PERMISSIONS.purchaseApprove]),
  );
  const canViewInventory = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView]),
  );
  const canViewPurchasing = useSessionStore((state) => hasAnyPermission(state.user, PURCHASING_READ_PERMISSIONS));
  const canManageSystem = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.systemManage));

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={canManageMenu}>
        <Stack.Screen name="menu" />
        <Stack.Screen name="ingredients" />
      </Stack.Protected>
      <Stack.Protected guard={canManageStaff}>
        <Stack.Screen name="staff" />
      </Stack.Protected>
      <Stack.Protected guard={canViewPrinters}>
        <Stack.Screen name="printers" />
      </Stack.Protected>
      <Stack.Protected guard={canManageSettings}>
        <Stack.Screen name="settings/index" />
      </Stack.Protected>
      <Stack.Protected guard={canViewTables}>
        <Stack.Screen name="tables/index" />
      </Stack.Protected>
      <Stack.Protected guard={canViewShifts}>
        <Stack.Screen name="shifts" />
      </Stack.Protected>
      <Stack.Protected guard={canViewReports}>
        <Stack.Screen name="reports/index" />
      </Stack.Protected>
      <Stack.Protected guard={canViewInventory}>
        <Stack.Screen name="inventory" />
      </Stack.Protected>
      <Stack.Protected guard={canViewPurchasing}>
        <Stack.Screen name="purchasing" />
      </Stack.Protected>
      <Stack.Protected guard={canManageSystem}>
        <Stack.Screen name="devices" />
        <Stack.Screen name="error-log" />
      </Stack.Protected>
    </Stack>
  );
}
