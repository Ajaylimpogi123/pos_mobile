import { memo } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { CatalogImage } from '@/components/menu/CatalogImage';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, hitTarget, numeric, pressedScale, radius, spacing, typography } from '@/constants/theme';
import type { AdminProduct } from '@/services/types';
import { formatPeso } from '@/utils/money';
import { formatCount } from '@/utils/numbers';

type ProductCardProps = {
  product: AdminProduct;
  /** Stable handlers (they receive the product), so the memoized card only re-renders when its data changes. */
  onPress: (product: AdminProduct) => void;
  onToggleAvailable: (product: AdminProduct, isAvailable: boolean) => void;
  /** The availability PATCH is in flight: the switch is disabled meanwhile. */
  toggling?: boolean;
};

/**
 * Admin product card: rounded white card, 4:3 image (placeholder icon when
 * `image_url` is null), name, category, bold green price, an "Unavailable"
 * pill, the stock on hand for `track_stock` products (red at 0 or below),
 * the cost in muted text, and a quick availability Switch.
 * Tapping the card (not the switch) opens the edit form.
 */
export const ProductCard = memo(function ProductCard({ product, onPress, onToggleAvailable, toggling = false }: ProductCardProps) {
  const testID = `product-card-${product.id}`;

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${formatPeso(product.price_cents)}${product.is_available ? '' : ', unavailable'}`}
        accessibilityHint="Opens the product to edit it"
        onPress={() => onPress(product)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <CatalogImage
          uri={product.image_url}
          placeholderIcon="fast-food-outline"
          accessibilityLabel={product.name}
          recyclingKey={String(product.id)}
          dimmed={!product.is_available}
          testID={`${testID}-thumb`}
        />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={styles.category} numberOfLines={1}>
            {product.category.name}
            {product.sku ? ` · ${product.sku}` : ''}
          </Text>
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price} numberOfLines={1} testID={`${testID}-price`}>
            {formatPeso(product.price_cents)}
          </Text>
          {product.is_available ? null : <Chip label="Unavailable" variant="cancelled" testID={`${testID}-unavailable`} />}
          {product.track_stock && product.stock_qty !== null ? (
            <Chip
              label={`${formatCount(product.stock_qty)} in stock`}
              variant={product.stock_qty <= 0 ? 'cancelled' : 'neutral'}
              icon="cube-outline"
              testID={`${testID}-stock`}
            />
          ) : null}
        </View>
        <Text style={styles.cost} numberOfLines={1} testID={`${testID}-cost`}>
          Cost {formatPeso(product.cost_cents)}
        </Text>
      </Pressable>

      <View style={styles.footer}>
        <Text style={styles.footerLabel} numberOfLines={1}>
          {product.is_available ? 'Available' : 'Unavailable'}
        </Text>
        <Switch
          value={product.is_available}
          onValueChange={(value) => onToggleAvailable(product, value)}
          disabled={toggling}
          accessibilityLabel={`${product.name} available`}
          trackColor={{ false: colors.borderStrong, true: colors.primaryBright }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.borderStrong}
          testID={`${testID}-switch`}
        />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    gap: spacing.md,
  },
  body: {
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  text: {
    gap: spacing.xxs,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  category: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  price: {
    ...typography.price,
    color: colors.primary,
  },
  cost: {
    ...typography.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: hitTarget.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  footerLabel: {
    ...typography.label,
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
