import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { reorderText, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { CatalogImage } from '@/components/menu/CatalogImage';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import type { InventoryItem } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

type InventoryCardProps = {
  item: InventoryItem;
  /** Receives the item, so the list passes one stable handler to the memoized cards. */
  onPress: (item: InventoryItem) => void;
};

/**
 * One tracked product on the inventory list: the image, name and category,
 * the quantity on hand in large type (red at 0 or below), the status chip
 * (`In stock` / `Low` / `Out`), `Reorder at 10` (or `No reorder level`), and
 * the stock value. The whole card opens the product's stock.
 */
export const InventoryCard = memo(function InventoryCard({ item, onPress }: InventoryCardProps) {
  const testID = `inventory-card-${item.product_id}`;
  const status = STOCK_STATUS_CHIP[item.status];
  const reorder = reorderText(item.reorder_level);
  const value = formatPeso(item.stock_value_cents);

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatCount(item.qty)} on hand, ${status.label}, ${reorder}, stock value ${value}`}
        accessibilityHint="Opens the product's stock and history"
        onPress={() => onPress(item)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.top}>
          <CatalogImage
            uri={item.image_url}
            placeholderIcon="cube-outline"
            accessibilityLabel={item.name}
            recyclingKey={String(item.product_id)}
            dimmed={!item.is_available}
            style={styles.thumb}
          />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {item.category.name}
              {item.sku ? ` · ${item.sku}` : ''}
            </Text>
            {item.is_available ? null : <Chip label="Unavailable" testID={`${testID}-unavailable`} />}
          </View>
        </View>

        <View style={styles.qtyRow}>
          <View style={styles.qtyBox}>
            <Text style={[styles.qty, item.qty <= 0 && styles.qtyOut]} numberOfLines={1} adjustsFontSizeToFit testID={`${testID}-qty`}>
              {formatCount(item.qty)}
            </Text>
            <Text style={styles.muted}>on hand</Text>
          </View>
          <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.muted} numberOfLines={1} testID={`${testID}-reorder`}>
            {reorder}
          </Text>
          <Text style={styles.value} numberOfLines={1} testID={`${testID}-value`}>
            {value}
          </Text>
        </View>
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
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexShrink: 1,
  },
  qty: {
    ...typography.display,
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
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  value: {
    ...typography.price,
    color: colors.primary,
    flexShrink: 0,
  },
});
