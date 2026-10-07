import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, numeric, spacing, typography } from '@/constants/theme';
import { formatPeso } from '@/utils/money';

type AmountRowProps = {
  label: string;
  /** Integer centavos. */
  cents: number;
  /** Shown as a deduction ("−₱10.00"), e.g. a discount. */
  deduction?: boolean;
  /**
   * `total`: the large tabular total (heavy, dark); `strong`: bold;
   * `summary`: a quiet breakdown line (secondary label, dark amount);
   * `muted`: secondary text (e.g. the VAT breakdown).
   */
  variant?: 'normal' | 'strong' | 'summary' | 'total' | 'muted';
  /** A second, muted line under the label (e.g. "Promo · 10%"). */
  detail?: string;
  testID?: string;
};

/**
 * One line of a money breakdown: the label on the left, the amount on the
 * right in tabular digits (formatted only here, from integer centavos). Long
 * labels wrap; the amount never does (a total shrinks to fit instead).
 */
export const AmountRow = memo(function AmountRow({
  label,
  cents,
  deduction = false,
  variant = 'normal',
  detail,
  testID,
}: AmountRowProps) {
  const amount = deduction && cents > 0 ? `−${formatPeso(cents)}` : formatPeso(cents);
  const total = variant === 'total';

  return (
    <View
      style={[styles.row, total && styles.rowTotal]}
      accessible
      accessibilityLabel={`${label}${detail ? `, ${detail}` : ''}: ${amount}`}
      testID={testID}
    >
      <View style={styles.labels}>
        <Text style={[styles.label, variantStyles[variant].label]}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <Text
        style={[styles.amount, variantStyles[variant].amount]}
        numberOfLines={1}
        adjustsFontSizeToFit={total}
        testID={testID ? `${testID}-amount` : undefined}
      >
        {amount}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowTotal: {
    alignItems: 'baseline',
  },
  labels: {
    flex: 1,
    gap: spacing.xxs,
  },
  label: {
    ...typography.body,
    color: colors.text,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
    textAlign: 'right',
  },
});

const variantStyles = {
  normal: StyleSheet.create({ label: {}, amount: {} }),
  strong: StyleSheet.create({
    label: { ...typography.bodyStrong },
    amount: { ...typography.bodyStrong, ...numeric },
  }),
  summary: StyleSheet.create({
    label: { ...typography.navItem, color: colors.textSecondary },
    amount: { ...typography.navItem, ...numeric },
  }),
  total: StyleSheet.create({
    label: { ...typography.heading },
    amount: { ...typography.total, color: colors.text, flexShrink: 1 },
  }),
  muted: StyleSheet.create({
    label: { ...typography.bodySm, color: colors.textSecondary },
    amount: { ...typography.bodySm, ...numeric, color: colors.textSecondary },
  }),
} as const;
