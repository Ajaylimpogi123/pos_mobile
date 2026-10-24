import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Dine-in tabs: the tab screen and its Pay screen. Gated on `sale.create` by `(pos)/_layout.tsx`. */
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
