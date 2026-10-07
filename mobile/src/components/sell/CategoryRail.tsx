import { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, hitTarget, layout, numeric, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import type { MenuCategory } from '@/db/menuQueries';
import { useResponsive } from '@/hooks/useResponsive';

/** Test IDs of the category filter, shared by the side rail and the pill row: `<prefix>-all`, `<prefix>-<id>`. */
export const CATEGORY_FILTER_TEST_ID = 'sell-category';

type CategoryRailProps = {
  categories: readonly MenuCategory[];
  selectedId: number | null;
  /** Keep it stable (e.g. a state setter): the pills are memoised. */
  onChange: (id: number | null) => void;
  /**
   * `side`: a vertical column beside the tiles (tablet landscape, from `sellLayoutFor`).
   * `row`: a horizontally scrolling pill row above the tiles (every other size).
   */
  variant: 'side' | 'row';
};

type PillProps = {
  id: number | null;
  label: string;
  /** Available products. */
  count: number;
  selected: boolean;
  onSelect: (id: number | null) => void;
  fill: boolean;
  testID: string;
};

/** A 44 dp pill: label + count badge; the selected one is solid primary. */
const CategoryPill = memo(function CategoryPill({ id, label, count, selected, onSelect, fill, testID }: PillProps) {
  const press = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count} available`}
      accessibilityState={{ selected }}
      onPress={press}
      testID={testID}
      style={({ pressed }) => [
        styles.pill,
        fill && styles.pillFill,
        selected ? styles.pillSelected : styles.pillIdle,
        pressed && (selected ? styles.pillSelectedPressed : styles.pillIdlePressed),
      ]}
    >
      <Text style={[styles.label, fill && styles.labelFill, selected && styles.labelSelected]} numberOfLines={fill ? 2 : 1}>
        {label}
      </Text>
      <View style={[styles.count, selected && styles.countSelected]}>
        <Text style={[styles.countText, selected && styles.countTextSelected]}>{count}</Text>
      </View>
    </Pressable>
  );
});

/**
 * The category filter: "All items" then every visible category in menu
 * order, each with its available-product count. As a side column on tablet
 * landscape (it scrolls with many categories), else as the pill row above the
 * tiles (it scrolls sideways).
 */
export function CategoryRail({ categories, selectedId, onChange, variant }: CategoryRailProps) {
  const { screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const side = variant === 'side';
  const total = useMemo(() => categories.reduce((sum, category) => sum + category.products_count, 0), [categories]);

  const pills = (
    <>
      <CategoryPill
        id={null}
        label="All items"
        count={total}
        selected={selectedId === null}
        onSelect={onChange}
        fill={side}
        testID={`${CATEGORY_FILTER_TEST_ID}-all`}
      />
      {categories.map((category) => (
        <CategoryPill
          key={category.id}
          id={category.id}
          label={category.name}
          count={category.products_count}
          selected={selectedId === category.id}
          onSelect={onChange}
          fill={side}
          testID={`${CATEGORY_FILTER_TEST_ID}-${category.id}`}
        />
      ))}
    </>
  );

  if (side) {
    return (
      <View style={styles.rail} testID="sell-category-rail">
        <ScrollView
          contentContainerStyle={[
            styles.railContent,
            { paddingTop: gutter, paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {pills}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.rowScroll}
      contentContainerStyle={[styles.rowContent, { paddingHorizontal: screenPaddingX }]}
      testID={`${CATEGORY_FILTER_TEST_ID}s`}
    >
      {pills}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: layout.categoryRailWidth,
  },
  railContent: {
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  rowScroll: {
    flexGrow: 0,
  },
  rowContent: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: hitTarget.min,
    borderRadius: radius.pill,
    borderWidth: sizes.borderWidth,
    paddingHorizontal: spacing.lg,
  },
  pillFill: {
    paddingVertical: spacing.xs,
  },
  pillIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  pillIdlePressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ scale: pressedScale }],
  },
  pillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillSelectedPressed: {
    backgroundColor: colors.primaryPressed,
    borderColor: colors.primaryPressed,
    transform: [{ scale: pressedScale }],
  },
  label: {
    ...typography.control,
    color: colors.textResting,
  },
  labelFill: {
    flex: 1,
  },
  labelSelected: {
    color: colors.onPrimary,
  },
  count: {
    minWidth: spacing.xxl,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    alignItems: 'center',
  },
  countSelected: {
    backgroundColor: colors.onGradientSurface,
  },
  countText: {
    ...typography.captionStrong,
    ...numeric,
    color: colors.textSecondary,
  },
  countTextSelected: {
    color: colors.onPrimary,
  },
});
