import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { colors, iconSizes, motion, numeric, opacity, radius, sizes, spacing, status, typography } from '@/constants/theme';
import { describeDiscount } from '@pos/core/sale/discountRules';
import type { PricedLine } from '@pos/core/sale/pricing';
import { CART_LIMITS, type CartLine } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';

type CartLineRowProps = {
  line: CartLine;
  priced: PricedLine | undefined;
  index: number;
  /** A server or pricing message for this line (e.g. "Only 2 "Iced Tea" left in stock."). */
  error: string | undefined;
  /** Offline Sales: "Only 2 left (offline estimate)" (informs; never blocks). */
  warning?: string;
  /** The cart can't change (an unconfirmed sale attempt). */
  locked: boolean;
  /** Senior Citizen / PWD Discount: the line is marked for the SC/PWD (`items` mode). */
  scPwd?: boolean;
  /** Changes when a tap just added to this line: the line highlights for 600 ms (sell.md). `0`: none. */
  highlightToken?: number;
  onEdit: (line: CartLine) => void;
  onQtyChange: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
};

/**
 * One cart line (MASTER §3 Current Order card, sell.md): a line box (radius 8,
 * hairline border) with a 44 dp thumbnail, the name, the unit price in green
 * ("₱X each"), its tags (SC/PWD, discount) and note, all tapping through to
 * the line editor, and × remove; under it the round stepper and the line total
 * in green (after its own discount). A message (e.g. a stock `422`) shows in
 * red under the line until it changes; offline, an "offline estimate" stock
 * warning shows too (Offline Sales). A tap on the menu that adds to this line
 * highlights it briefly.
 */
export const CartLineRow = memo(function CartLineRow({
  line,
  priced,
  index,
  error,
  warning,
  locked,
  scPwd = false,
  highlightToken = 0,
  onEdit,
  onQtyChange,
  onRemove,
}: CartLineRowProps) {
  const testID = `cart-line-${index}`;
  const amount = formatPeso(priced?.net_cents ?? line.product.price_cents * line.qty);
  const edit = useCallback(() => onEdit(line), [onEdit, line]);
  const changeQty = useCallback((qty: number) => onQtyChange(line.key, qty), [onQtyChange, line.key]);
  const remove = useCallback(() => onRemove(line.key), [onRemove, line.key]);

  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    if (highlightToken === 0) return undefined;
    setHighlighted(true);
    const timer = setTimeout(() => setHighlighted(false), motion.lineHighlightMs);
    return () => clearTimeout(timer);
  }, [highlightToken]);

  return (
    <View
      style={[styles.box, highlighted && styles.boxHighlighted, error ? styles.boxError : null]}
      testID={testID}
    >
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${line.qty} × ${line.product.name}, ${amount}`}
          accessibilityHint="Edits the quantity, discount and note"
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          onPress={edit}
          style={({ pressed }) => [styles.info, pressed && styles.pressed]}
          testID={`${testID}-edit`}
        >
          <View style={styles.thumb}>
            <Icon name="restaurant-outline" size={iconSizes.md} color={colors.textMuted} />
          </View>
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={2}>
              {line.product.name}
            </Text>
            <Text style={styles.each} numberOfLines={1}>
              {formatPeso(line.product.price_cents)} each
            </Text>
            {scPwd ? <Chip label="SC/PWD" variant="neutral" icon="id-card-outline" testID={`${testID}-sc-pwd`} /> : null}
            {line.discount ? (
              <Chip
                label={`${describeDiscount(line.discount)} · −${formatPeso(priced?.line_discount_cents ?? 0)}`}
                variant="neutral"
                icon="pricetag-outline"
                testID={`${testID}-discount`}
              />
            ) : null}
            {line.notes ? (
              <Text style={styles.meta} numberOfLines={2} testID={`${testID}-notes`}>
                “{line.notes}”
              </Text>
            ) : null}
          </View>
        </Pressable>
        <IconButton
          icon="close"
          variant="ghost"
          accessibilityLabel={`Remove ${line.product.name}`}
          onPress={remove}
          disabled={locked}
          testID={`${testID}-remove`}
        />
      </View>
      <View style={styles.controls}>
        <QtyStepper
          value={line.qty}
          onChange={changeQty}
          max={CART_LIMITS.maxQty}
          accessibilityLabel={`${line.product.name} quantity`}
          disabled={locked}
          testID={`${testID}-qty`}
        />
        <Text style={styles.amount} numberOfLines={1} testID={`${testID}-amount`}>
          {amount}
        </Text>
      </View>
      {warning ? (
        <Text style={styles.warning} accessibilityLiveRegion="polite" testID={`${testID}-stock-warning`}>
          {warning}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  boxHighlighted: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.greenChip,
  },
  boxError: {
    backgroundColor: colors.dangerSoft,
    borderColor: status.cancelled.border,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  info: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.sm,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  thumb: {
    width: sizes.cartThumb,
    height: sizes.cartThumb,
    borderRadius: radius.md,
    backgroundColor: colors.imageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...typography.controlStrong,
    color: colors.text,
  },
  each: {
    ...typography.captionStrong,
    ...numeric,
    color: colors.green,
  },
  meta: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.price,
    color: colors.green,
    textAlign: 'right',
    flexShrink: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  warning: {
    ...typography.bodySm,
    color: colors.warningText,
  },
});

