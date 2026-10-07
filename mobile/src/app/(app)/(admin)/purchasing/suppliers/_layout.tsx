import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** Suppliers: read with any purchase permission; `new` needs `supplier.manage` (edits are gated in the form). */
export default function SuppliersLayout() {
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.supplierManage));
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Protected guard={canManage}>
        <Stack.Screen name="new" />
      </Stack.Protected>
    </Stack>
  );
}
