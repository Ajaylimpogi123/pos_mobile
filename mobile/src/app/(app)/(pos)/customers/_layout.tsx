import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * Customers: every signed-in user may look them up (index, [id]). Creating
 * one needs `sale.create`, so `new` is a protected screen. Editing and
 * deleting are gated inside the form (`sale.create` / `customer.manage`).
 * UI hints only: the server enforces every permission.
 */
export default function CustomersLayout() {
  const canCreate = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Protected guard={canCreate}>
        <Stack.Screen name="new" />
      </Stack.Protected>
    </Stack>
  );
}
