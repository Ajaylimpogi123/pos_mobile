import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Shifts (Phase 6): the list and one shift's report. Gated on `report.zread` by `(admin)/_layout.tsx`. */
export default function ShiftsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
