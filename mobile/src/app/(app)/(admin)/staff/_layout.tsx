import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Staff management. Gated on `user.manage` by `(admin)/_layout.tsx`. */
export default function StaffLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
