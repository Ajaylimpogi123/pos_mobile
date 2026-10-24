import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Error log (Phase 8 §E): the groups and one group. Gated on `system.manage` by `(admin)/_layout.tsx`. */
export default function ErrorLogLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
