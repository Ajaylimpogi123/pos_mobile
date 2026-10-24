import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import {
  colors,
  gradients,
  iconSizes,
  layout,
  numeric,
  pressedScale,
  radius,
  shadows,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import type { MenuCategory } from '@/db/menuQueries';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useResponsive } from '@/hooks/useResponsive';

/** Test IDs of the category tabs: `<prefix>-all`, `<prefix>-<id>`, and `<prefix>s` (the scroll row). */
export const CATEGORY_FILTER_TEST_ID = 'sell-category';

type CategoryRailProps = {
  categories: readonly MenuCategory[];
  selectedId: number | null;
  /** Keep it stable (e.g. a state setter): the tiles are memoised. */
  onChange: (id: number | null) => void;
};

type TileProps = {
  id: number | null;
  label: string;
  /** Available products. */
  count: number;
  icon: IconName;
  selected: boolean;
  onSelect: (id: number | null) => void;
  testID: string;
};

function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/**
 * One category tab tile (MASTER §3, the legacy tab tiles): 112 dp wide.
 * - Inactive: a #F3F4F6 → #F9FAFB gradient with a 4 px #D1D5DB **top** border.
 * - Active: white → `green-soft` with a 4 px `green-line` **bottom** border and the tile shadow.
 * An icon in a 40 dp circle (`green-chip` when active), the name (15 / 500)
 * and the count ("4 items", 12, #4B5563).
 */
const CategoryTile = memo(function CategoryTile({ id, label, count, icon, selected, onSelect, testID }: TileProps) {
  const press = useCallback(() => onSelect(id), [onSelect, id]);
  const reduceMotion = useReducedMotion();
  const gradient = selected ? gradients.tileActive.colors : gradients.tileInactive.colors;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label}, ${count} available`}
      accessibilityState={{ selected }}
      onPress={press}
      testID={testID}
      style={({ pressed }) => [
        styles.tile,
        selected ? styles.tileActive : styles.tileIdle,
        pressed && !reduceMotion && styles.pressed,
      ]}
    >
      <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={[styles.iconCircle, selected ? styles.iconCircleActive : styles.iconCircleIdle]}>
        <Icon name={icon} size={iconSizes.md} color={selected ? colors.greenHover : colors.textResting} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.count} numberOfLines={1}>
        {itemsLabel(count)}
      </Text>
    </Pressable>
  );
});

/**
 * The category tabs (sell.md, Menu column step 2): "All" then every visible
 * category in menu order, each with its available-product count, as tab tiles
 * in a white card. It scrolls sideways (the only horizontal scroll on Sell).
 */
export function CategoryRail({ categories, selectedId, onChange }: CategoryRailProps) {
  const { screenPaddingX } = useResponsive();
  const total = useMemo(() => categories.reduce((sum, category) => sum + category.products_count, 0), [categories]);

  return (
    <View style={[styles.wrap, { paddingHorizontal: screenPaddingX }]}>
      <View style={styles.card}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.row}
          accessibilityRole="tablist"
          testID={`${CATEGORY_FILTER_TEST_ID}s`}
        >
          <CategoryTile
            id={null}
            label="All"
            count={total}
            icon="grid-outline"
            selected={selectedId === null}
            onSelect={onChange}
            testID={`${CATEGORY_FILTER_TEST_ID}-all`}
          />
          {categories.map((category) => (
            <CategoryTile
              key={category.id}
              id={category.id}
              label={category.name}
              count={category.products_count}
              icon="restaurant-outline"
              selected={selectedId === category.id}
              onSelect={onChange}
              testID={`${CATEGORY_FILTER_TEST_ID}-${category.id}`}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    ...shadows.sm,
  },
  row: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  tile: {
    width: layout.categoryTileWidth,
    overflow: 'hidden',
    borderRadius: radius.md,
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tileIdle: {
    borderTopWidth: sizes.categoryTileBorder,
    borderTopColor: colors.borderStrong,
  },
  tileActive: {
    borderBottomWidth: sizes.categoryTileBorder,
    borderBottomColor: colors.greenLine,
    ...shadows.tile,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  iconCircle: {
    width: sizes.categoryIcon,
    height: sizes.categoryIcon,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxs,
  },
  iconCircleIdle: {
    backgroundColor: colors.surface,
  },
  iconCircleActive: {
    backgroundColor: colors.greenChip,
  },
  name: {
    ...typography.tileName,
    color: colors.text,
    textAlign: 'center',
  },
  count: {
    ...typography.captionMedium,
    ...numeric,
    color: colors.textSubtle,
  },
});
