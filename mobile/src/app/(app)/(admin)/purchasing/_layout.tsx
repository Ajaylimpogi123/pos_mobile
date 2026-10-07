import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS, PURCHASE_PERMISSIONS, PURCHASING_READ_PERMISSIONS } from '@/utils/permissions';

/**
 * Purchasing (Ingredients, Recipes & Purchasing §E): mounted by `(admin)/_layout.tsx`
 * for any purchase permission or `report.view`; each section is gated here:
 * - `requests/…`, `orders/…`: any purchase permission or `report.view` (writes gated inside)
 * - `receiving/…`: `purchase.receive`
 * - `suppliers/…`: any purchase permission (`new` needs `supplier.manage`)
 * UI hints only: the server enforces every permission.
 */
export default function PurchasingLayout() {
  const canRead = useSessionStore((state) => hasAnyPermission(state.user, PURCHASING_READ_PERMISSIONS));
  const canReceive = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.purchaseReceive));
  const canSeeSuppliers = useSessionStore((state) => hasAnyPermission(state.user, PURCHASE_PERMISSIONS));

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={canRead}>
        <Stack.Screen name="requests" />
        <Stack.Screen name="orders" />
      </Stack.Protected>
      <Stack.Protected guard={canReceive}>
        <Stack.Screen name="receiving" />
      </Stack.Protected>
      <Stack.Protected guard={canSeeSuppliers}>
        <Stack.Screen name="suppliers" />
      </Stack.Protected>
    </Stack>
  );
}
