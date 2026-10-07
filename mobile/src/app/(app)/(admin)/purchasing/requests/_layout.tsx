import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * Purchase requests: `new` needs `purchase.request`; `[ulid]/edit` the
 * requester or `purchase.approve` (the detail only offers Edit when allowed).
 */
export default function PurchaseRequestsLayout() {
  const canRequest = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.purchaseRequest));
  const canEdit = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.purchaseRequest, PERMISSIONS.purchaseApprove]),
  );

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[ulid]/index" />
      <Stack.Protected guard={canRequest}>
        <Stack.Screen name="new" />
      </Stack.Protected>
      <Stack.Protected guard={canEdit}>
        <Stack.Screen name="[ulid]/edit" />
      </Stack.Protected>
    </Stack>
  );
}
