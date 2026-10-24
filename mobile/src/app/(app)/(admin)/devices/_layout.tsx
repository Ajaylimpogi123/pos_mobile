import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Admin Devices (Phase 8 §E): the list and one device. Gated on `system.manage` by `(admin)/_layout.tsx`. */
export default function DevicesLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
