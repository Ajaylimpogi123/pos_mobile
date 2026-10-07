import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * Printers (Printing, Phase 4). `(admin)/_layout.tsx` mounts this for
 * `sale.create` or `settings.manage`:
 * - `index`: the list (works offline from the cached print config), for both
 * - `new`, `[id]`: create and edit, `settings.manage` only
 * UI hints: the API still enforces `settings.manage` (403).
 */
export default function PrintersLayout() {
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.settingsManage));

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={canManage}>
        <Stack.Screen name="new" />
        <Stack.Screen name="[id]" />
      </Stack.Protected>
    </Stack>
  );
}
