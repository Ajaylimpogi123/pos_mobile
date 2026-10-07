import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { ROUTES } from '@/constants/routes';
import { layout } from '@/constants/theme';

export type InventoryKind = 'products' | 'ingredients';

const KINDS: readonly SegmentOption<InventoryKind>[] = [
  { value: 'products', label: 'Products', icon: 'fast-food-outline', testID: 'inventory-kind-products' },
  { value: 'ingredients', label: 'Ingredients', icon: 'nutrition-outline', testID: 'inventory-kind-ingredients' },
];

const KIND_ROUTES = {
  products: ROUTES.inventory,
  ingredients: ROUTES.inventoryIngredients,
} as const;

/**
 * The Inventory `Products | Ingredients` switch (§L), just below the bar.
 * Switching replaces the route, so Back always returns to where Inventory was opened from.
 */
export function InventoryKindSwitch({ kind }: { kind: InventoryKind }) {
  return (
    <SegmentedControl
      options={KINDS}
      value={kind}
      accessibilityLabel="Inventory of"
      onChange={(next) => {
        if (next !== kind) router.replace(KIND_ROUTES[next]);
      }}
      style={styles.switch}
      testID="inventory-kind"
    />
  );
}

const styles = StyleSheet.create({
  switch: {
    width: '100%',
    maxWidth: layout.segmentedMaxWidth,
  },
});
