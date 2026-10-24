import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { checkoutLabel, itemsLabel } from '@/components/sell/CartPanel';
import { Button } from '@/components/ui/Button';
import { colors, numeric, opacity, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { formatPeso } from '@pos/core/money';

type CartBarProps = {
  itemCount: number;
  totalCents: number;
  /** The table number as typed (`''`: none). */
  tableNo: string;
  /** Something on the cart needs attention (e.g. a stock message, an unconfirmed attempt). */
  attention: boolean;
  /** Phones: the left part opens the cart sheet. Omit where the cart is already on screen (tablet portrait). */
  onOpen?: () => void;
  /** The **Checkout (₱total)** pill. Omit it where the panel has its own actions (a dine-in tab). */
  onCheckout?: () => void;
  /** Checkout can't start (an empty cart, or a line with a problem). */
  checkoutDisabled?: boolean;
  /** An unconfirmed sale attempt: the button reads "Retry at checkout". */
  locked?: boolean;
};

/**
 * The pinned bottom bar (sell.md: "n items · ₱total · Checkout"), on tablet
 * portrait (under the always-visible cart) and on phones (where its left part
 * opens the cart sheet). Its **Checkout (₱total)** pill goes straight to
 * checkout. It pads the bottom, left and right safe areas.
 */
export const CartBar = memo(function CartBar({
  itemCount,
  totalCents,
  tableNo,
  attention,
  onOpen,
  onCheckout,
  checkoutDisabled = false,
  locked = false,
}: CartBarProps) {
  const { screenPaddingX, isCompactHeight, isPhone, isPortrait } = useResponsive();
  const items = itemsLabel(itemCount);
  const total = formatPeso(totalCents);
  const table = tableNo.trim();
  // Phones in portrait: the pill is short ("Checkout"); the total shows beside the items.
  const compactPill = isPhone && isPortrait;

  const summary = (
    <>
      <View style={styles.count}>
        <Text style={styles.countText} numberOfLines={1} testID="cart-bar-count">
          {itemCount}
        </Text>
        {attention ? <View style={styles.badge} testID="cart-bar-attention" /> : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.items} numberOfLines={1} testID="cart-bar-text">
          {items}
          {table !== '' ? ` · Table ${table}` : ''}
        </Text>
        <Text style={styles.total} numberOfLines={1} testID="cart-bar-total">
          {total}
        </Text>
      </View>
    </>
  );

  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.wrap, { paddingHorizontal: screenPaddingX }, isCompactHeight && styles.wrapCompact]}
    >
      <View style={styles.bar}>
        {onOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View order, ${items}, ${total}${attention ? ', needs attention' : ''}`}
            accessibilityHint="Opens the cart"
            onPress={onOpen}
            style={({ pressed }) => [styles.info, pressed && styles.infoPressed]}
            testID="cart-bar"
          >
            {summary}
          </Pressable>
        ) : (
          <View
            style={styles.info}
            accessible
            accessibilityLabel={`${items}, ${total}${attention ? ', needs attention' : ''}`}
            testID="cart-bar"
          >
            {summary}
          </View>
        )}
        {onCheckout ? (
        <Button
          title={locked ? 'Retry at checkout' : compactPill ? 'Checkout' : checkoutLabel(totalCents)}
          leftIcon={locked ? 'refresh' : undefined}
          onPress={onCheckout}
          disabled={checkoutDisabled}
          accessibilityLabel={locked ? 'Retry the sale at checkout' : checkoutLabel(totalCents)}
          style={styles.checkout}
          testID="cart-bar-checkout"
        />
        ) : null}
      </View>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    ...shadows.lg,
  },
  wrapCompact: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.cta,
  },
  info: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.cta,
    borderRadius: radius.md,
  },
  infoPressed: {
    opacity: opacity.pressed,
  },
  count: {
    minWidth: sizes.iconButton.md,
    height: sizes.iconButton.md,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  badge: {
    position: 'absolute',
    top: -spacing.xxs,
    right: -spacing.xxs,
    width: spacing.md,
    height: spacing.md,
    borderRadius: radius.pill,
    borderWidth: spacing.xxs,
    borderColor: colors.surface,
    backgroundColor: colors.warning,
  },
  text: {
    flex: 1,
  },
  items: {
    ...typography.captionStrong,
    color: colors.textSecondary,
  },
  total: {
    ...typography.price,
    color: colors.green,
  },
  checkout: {
    minHeight: sizes.cta,
    flexShrink: 0,
  },
});
