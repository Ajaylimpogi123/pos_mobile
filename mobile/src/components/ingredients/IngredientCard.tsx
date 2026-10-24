import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { CatalogImage } from '@/components/menu/CatalogImage';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, numeric, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import type { Ingredient } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatQty, friendlyQty } from '@pos/core/quantity';

type IngredientCardProps = {
  ingredient: Ingredient;
  /** Receives the ingredient, so a list can pass one stable handler to the memoized cards. */
  onPress: (ingredient: Ingredient) => void;
  /** `admin`: the base unit and own units; `stock`: the quantity and the reorder level. */
  variant: 'admin' | 'stock';
};

/** `Reorder at 5,000 g`, or `No reorder level`. */
export function ingredientReorderText(ingredient: Pick<Ingredient, 'reorder_level' | 'base_unit'>): string {
  return ingredient.reorder_level === null
    ? 'No reorder level'
    : `Reorder at ${formatQty(ingredient.reorder_level)} ${ingredient.base_unit}`;
}

/** `sack, cup` or `No own units`. */
function unitsText(ingredient: Ingredient): string {
  return ingredient.units.length === 0 ? 'No own units' : ingredient.units.map((unit) => unit.name).join(', ');
}

/**
 * One ingredient card: the photo, the name, and either its units (the admin
 * list) or its stock (the Inventory → Ingredients list: the quantity in its
 * base unit with a friendlier unit under it, the status chip, the reorder
 * level and the stock value). The whole card opens the ingredient.
 */
export const IngredientCard = memo(function IngredientCard({ ingredient, onPress, variant }: IngredientCardProps) {
  const testID = `ingredient-card-${ingredient.id}`;
  const status = STOCK_STATUS_CHIP[ingredient.status];
  const qty = `${formatQty(ingredient.qty)} ${ingredient.base_unit}`;
  const friendly = friendlyQty(ingredient.qty, ingredient.base_unit);
  const out = ingredient.status === 'out';
  const spoken =
    variant === 'stock'
      ? `${ingredient.name}, ${qty} on hand, ${status.label}, ${ingredientReorderText(ingredient)}`
      : `${ingredient.name}, base unit ${ingredient.base_unit}, ${unitsText(ingredient)}${ingredient.is_active ? '' : ', inactive'}`;

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint={variant === 'stock' ? "Opens the ingredient's stock and history" : 'Opens the ingredient'}
        onPress={() => onPress(ingredient)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.top}>
          <CatalogImage
            uri={ingredient.image_url}
            placeholderIcon="nutrition-outline"
            accessibilityLabel={ingredient.name}
            recyclingKey={`ingredient-${ingredient.id}`}
            dimmed={!ingredient.is_active}
            style={styles.thumb}
          />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={2}>
              {ingredient.name}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              Base unit: {ingredient.base_unit}
            </Text>
            {ingredient.is_active ? null : <Chip label="Inactive" testID={`${testID}-inactive`} />}
          </View>
        </View>

        {variant === 'stock' ? (
          <>
            <View style={styles.qtyRow}>
              <View style={styles.qtyBox}>
                <Text style={[styles.qty, out && styles.qtyOut]} numberOfLines={1} adjustsFontSizeToFit testID={`${testID}-qty`}>
                  {qty}
                </Text>
                {friendly ? (
                  <Text style={styles.muted} numberOfLines={1} testID={`${testID}-friendly`}>
                    {friendly}
                  </Text>
                ) : null}
              </View>
              <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} />
            </View>
            <View style={styles.footer}>
              <Text style={styles.muted} numberOfLines={1} testID={`${testID}-reorder`}>
                {ingredientReorderText(ingredient)}
              </Text>
              <Text style={styles.value} numberOfLines={1} testID={`${testID}-value`}>
                {formatPeso(ingredient.stock_value_cents)}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.footer}>
            <Text style={styles.muted} numberOfLines={2} testID={`${testID}-units`}>
              {unitsText(ingredient)}
            </Text>
          </View>
        )}
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
  },
  body: {
    flexGrow: 1,
    gap: spacing.md,
    borderRadius: radius.md,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  top: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  thumb: {
    width: sizes.inventoryThumb,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  qtyBox: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  qty: {
    ...typography.display,
    ...numeric,
    color: colors.text,
  },
  qtyOut: {
    color: colors.dangerText,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  value: {
    ...typography.price,
    color: colors.primary,
    flexShrink: 0,
  },
});
