import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Ingredients admin (Ingredients, Recipes & Purchasing §D). Gated on `product.manage` by `(admin)/_layout.tsx`. */
export default function IngredientsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
