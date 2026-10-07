import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { productInitial, productTint } from '@/components/sell/productVisual';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { colors, fontFamilies, hitTarget, numeric, opacity, radius, spacing, typography } from '@/constants/theme';
import { describeDiscount } from '@/sale/discountRules';
import type { PricedLine } from '@/sale/pricing';
import { CART_LIMITS, type CartLine } from '@/stores/cart';
import { formatPeso } from '@/utils/money';

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
  onEdit: (line: CartLine) => void;
  onQtyChange: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
};

/** The thumbnail tile (44, radius 10) and the stepper sit in a column this wide. */
const THUMB = hitTarget.min;

/**
 * One cart line (POS board): a tinted thumbnail with the product's initial,
 * the name, "₱X each", its chips (SC/PWD, discount) and note, and the line
 * amount (after its own discount), all tapping through to the line editor;
 * under it the bordered qty stepper and a remove button. A message (e.g. a
 * stock `422`) shows in red under the line until it changes; offline, an
 * "offline estimate" stock warning shows too (Offline Sales).
 */
export const CartLineRow = memo(function CartLineRow({
  line,
  priced,
  index,
  error,
  warning,
  locked,
  scPwd = false,
  onEdit,
  onQtyChange,
  onRemove,
}: CartLineRowProps) {
  const testID = `cart-line-${index}`;
  const amount = formatPeso(priced?.net_cents ?? line.product.price_cents * line.qty);
  const tint = productTint(line.product.id);
  const edit = useCallback(() => onEdit(line), [onEdit, line]);
  const changeQty = useCallback((qty: number) => onQtyChange(line.key, qty), [onQtyChange, line.key]);
  const remove = useCallback(() => onRemove(line.key), [onRemove, line.key]);

  return (
    <View style={[styles.row, error ? styles.rowError : null]} testID={testID}>
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
        <View style={[styles.thumb, tint.backgroundStyle]}>
          <Text style={[styles.thumbText, tint.inkStyle]} accessibilityElementsHidden importantForAccessibility="no">
            {productInitial(line.product.name)}
          </Text>
        </View>
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={2}>
            {line.product.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatPeso(line.product.price_cents)} each
          </Text>
          {scPwd ? <Chip label="SC/PWD" variant="info" icon="id-card-outline" testID={`${testID}-sc-pwd`} /> : null}
          {line.discount ? (
            <Chip
              label={`${describeDiscount(line.discount)} · −${formatPeso(priced?.line_discount_cents ?? 0)}`}
              variant="primary"
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
        <Text style={styles.amount} numberOfLines={1} testID={`${testID}-amount`}>
          {amount}
        </Text>
      </Pressable>
      <View style={styles.controls}>
        <QtyStepper
          value={line.qty}
          onChange={changeQty}
          max={CART_LIMITS.maxQty}
          accessibilityLabel={`${line.product.name} quantity`}
          disabled={locked}
          testID={`${testID}-qty`}
        />
        <IconButton
          icon="trash-outline"
          variant="ghost"
          accessibilityLabel={`Remove ${line.product.name}`}
          onPress={remove}
          disabled={locked}
          testID={`${testID}-remove`}
        />
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
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowError: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.sm,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: {
    ...typography.section,
    fontFamily: fontFamilies.heavy,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...typography.control,
    color: colors.text,
  },
  meta: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.bodyStrong,
    ...numeric,
    fontFamily: fontFamilies.bold,
    color: colors.text,
    textAlign: 'right',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: THUMB + spacing.md,
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
