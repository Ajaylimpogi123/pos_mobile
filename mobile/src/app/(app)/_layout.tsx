import { Stack } from 'expo-router';

import { AppShell } from '@/components/shell/AppShell';
import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, PERMISSIONS, PURCHASE_PERMISSIONS } from '@/utils/permissions';

/**
 * The signed-in app shell: the sidebar beside a content Stack, so every
 * signed-in screen shares one navigation frame and pushes (e.g. list → edit)
 * stay inside the content area.
 * - `index`: the dashboard (the signed-in home)
 * - `switch-user`: the PIN quick-switch, open to every signed-in user
 * - `device`: "This tablet", the setup and health screen, every signed-in user (Phase 8 §E)
 * - `(pos)`: sell, checkout, orders and customers (its layout gates each on its permission)
 * - `(admin)`: with `product.manage`, `user.manage`, `settings.manage`,
 *   `sale.create` (the Printers list), `report.zread` (Shifts) or `report.view`
 *   (Reports and Inventory) or `inventory.adjust` (Inventory), or any purchase permission (Purchasing, Suppliers),
 *   or `system.manage` (Devices and the Error log, Phase 8);
 *   its layout then gates each section on its own permission with `Stack.Protected`
 * Permissions are UI hints: the API still enforces them (403).
 */
export default function AppLayout() {
  const canUseAdmin = useSessionStore((state) =>
    hasAnyPermission(state.user, [
      PERMISSIONS.productManage,
      PERMISSIONS.userManage,
      PERMISSIONS.settingsManage,
      PERMISSIONS.saleCreate,
      PERMISSIONS.reportZread,
      PERMISSIONS.reportView,
      PERMISSIONS.inventoryAdjust,
      PERMISSIONS.systemManage,
      ...PURCHASE_PERMISSIONS,
    ]),
  );

  return (
    <AppShell>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="switch-user" />
        <Stack.Screen name="device" />
        <Stack.Screen name="(pos)" />
        <Stack.Protected guard={canUseAdmin}>
          <Stack.Screen name="(admin)" />
        </Stack.Protected>
      </Stack>
    </AppShell>
  );
}
