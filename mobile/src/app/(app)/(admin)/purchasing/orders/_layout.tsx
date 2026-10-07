import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Purchase orders: the list and one order (writes are gated on the detail). */
export default function PurchaseOrdersLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
