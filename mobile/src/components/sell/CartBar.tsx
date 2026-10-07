import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontFamilies, hitTarget, numeric, pressedScale, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { formatPeso } from '@/utils/money';

type CartBarProps = {
  itemCount: number;
  totalCents: number;
  /** The table number as typed (`''`: none). */
  tableNo: string;
  /** Something on the cart needs attention (e.g. a stock message, an unconfirmed attempt). */
  attention: boolean;
  onOpen: () => void;
};

/** The count tile inside it. */
const COUNT_SIZE = hitTarget.min - spacing.sm - spacing.xxs;

/**
 * Phones and portrait (POS phone board): a floating dark "View order" bar at
 * the bottom of the Sell screen: the item count in a tile, "View order" with
 * the items and table, and the total in a white pill. It opens the cart
 * sheet, and pads the bottom, left and right safe areas.
 */
export const CartBar = memo(function CartBar({ itemCount, totalCents, tableNo, attention, onOpen }: CartBarProps) {
  const { screenPaddingX, isCompactHeight } = useResponsive();
  const items = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  const total = formatPeso(totalCents);
  const table = tableNo.trim();

  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.wrap, { paddingHorizontal: screenPaddingX }, isCompactHeight && styles.wrapCompact]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View order, ${items}, ${total}${attention ? ', needs attention' : ''}`}
        accessibilityHint="Opens the cart"
        onPress={onOpen}
        style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
        testID="cart-bar"
      >
        <View style={styles.count}>
          <Text style={styles.countText} numberOfLines={1} testID="cart-bar-count">
            {itemCount}
          </Text>
          {attention ? <View style={styles.badge} testID="cart-bar-attention" /> : null}
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            View order
          </Text>
          <Text style={styles.subtitle} numberOfLines={1} testID="cart-bar-text">
            {items}
            {table !== '' ? ` · Table ${table}` : ''}
          </Text>
        </View>
        <View style={styles.totalPill}>
          <Text style={styles.total} numberOfLines={1} testID="cart-bar-total">
            {total}
          </Text>
        </View>
      </Pressable>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.background,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  wrapCompact: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.cartBar,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDark,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    ...shadows.dark,
  },
  pressed: {
    backgroundColor: colors.primaryDarkPressed,
    transform: [{ scale: pressedScale }],
  },
  count: {
    minWidth: COUNT_SIZE,
    height: COUNT_SIZE,
    borderRadius: radius.inner,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.onBrandTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    ...typography.bodyStrong,
    ...numeric,
    fontFamily: fontFamilies.heavy,
    color: colors.onPrimary,
  },
  badge: {
    position: 'absolute',
    top: -spacing.xxs,
    right: -spacing.xxs,
    width: spacing.md,
    height: spacing.md,
    borderRadius: radius.pill,
    borderWidth: spacing.xxs,
    borderColor: colors.primaryDark,
    backgroundColor: colors.warning,
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.bodyStrong,
    fontFamily: fontFamilies.bold,
    color: colors.onPrimary,
  },
  subtitle: {
    ...typography.captionMedium,
    color: colors.onGradientMuted,
  },
  totalPill: {
    minHeight: hitTarget.min,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + spacing.xxs,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    flexShrink: 0,
  },
  total: {
    ...typography.section,
    ...numeric,
    fontFamily: fontFamilies.heavy,
    color: colors.primaryDark,
  },
});
