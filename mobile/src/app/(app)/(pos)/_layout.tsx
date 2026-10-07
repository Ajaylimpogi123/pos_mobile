import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * Point-of-sale area inside the app shell:
 * - `sell/index`: every signed-in user (the on-device menu; the cart needs `sale.create`)
 * - `sell/checkout`: `sale.create`
 * - `orders/…`: `sale.create` or `report.view`
 * - `customers/…`: every signed-in user (its own layout gates `new`)
 * - `sync-queue`: `sale.create` (Offline Sales: the sales saved on this tablet)
 * Gated with `Stack.Protected`; UI hints only: the server enforces every permission.
 */
export default function PosLayout() {
  const canSell = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const canViewOrders = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.saleCreate, PERMISSIONS.reportView]),
  );

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="sell/index" />
      <Stack.Screen name="customers" />
      <Stack.Protected guard={canSell}>
        <Stack.Screen name="sell/checkout" />
        <Stack.Screen name="sync-queue" />
      </Stack.Protected>
      <Stack.Protected guard={canViewOrders}>
        <Stack.Screen name="orders" />
      </Stack.Protected>
    </Stack>
  );
}
