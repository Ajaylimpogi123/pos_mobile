import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Inventory (v1 completion): the stock list and one product's stock. Gated on `inventory.adjust` or `report.view` by `(admin)/_layout.tsx`. */
export default function InventoryLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
