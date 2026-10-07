import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Receiving (`purchase.receive`, gated by `purchasing/_layout.tsx`). */
export default function ReceivingLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
