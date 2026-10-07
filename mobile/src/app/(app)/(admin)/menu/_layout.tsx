import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Menu admin (products and categories). Gated on `product.manage` by `(admin)/_layout.tsx`. */
export default function MenuLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
