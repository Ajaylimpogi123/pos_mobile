import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CatalogImage } from '@/components/menu/CatalogImage';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, numeric, pressedScale, spacing, typography } from '@/constants/theme';
import type { Category } from '@/services/types';

type CategoryCardProps = {
  category: Category;
  /** Stable handler (it receives the category), so the memoized card only re-renders when its data changes. */
  onPress: (category: Category) => void;
};

/** "1 item" / "3 items". */
export function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/** Admin category card: image, name, item count, active/inactive pill and sort order. Tap to edit. */
export const CategoryCard = memo(function CategoryCard({ category, onPress }: CategoryCardProps) {
  const testID = `category-card-${category.id}`;

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${category.name}, ${itemCountLabel(category.products_count)}, ${category.is_active ? 'active' : 'inactive'}`}
        accessibilityHint="Opens the category to edit it"
        onPress={() => onPress(category)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <CatalogImage
          uri={category.image_url}
          placeholderIcon="grid-outline"
          accessibilityLabel={category.name}
          recyclingKey={String(category.id)}
          dimmed={!category.is_active}
        />
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={2}>
            {category.name}
          </Text>
          <Chip
            label={category.is_active ? 'Active' : 'Inactive'}
            variant={category.is_active ? 'completed' : 'neutral'}
            testID={`${testID}-status`}
          />
        </View>
        {category.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {category.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <View style={styles.meta}>
            <Icon name="fast-food-outline" size={iconSizes.sm} color={colors.textSecondary} />
            <Text style={styles.metaText} testID={`${testID}-count`}>
              {itemCountLabel(category.products_count)}
            </Text>
          </View>
          <View style={styles.meta}>
            <Icon name="swap-vertical-outline" size={iconSizes.sm} color={colors.textSecondary} />
            <Text style={styles.metaText}>Sort {category.sort_order}</Text>
          </View>
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
    gap: spacing.sm,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  name: {
    ...typography.heading,
    color: colors.text,
    flex: 1,
  },
  description: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    ...typography.label,
    ...numeric,
    color: colors.textSecondary,
  },
});
