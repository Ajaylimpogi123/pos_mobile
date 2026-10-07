import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Orders: the list and the receipt-style detail. Gated on `sale.create` or `report.view` by `(pos)/_layout.tsx`. */
export default function OrdersLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
