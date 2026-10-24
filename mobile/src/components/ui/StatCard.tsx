import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, radius, sizes, spacing, statAccent, typography, type StatAccentKey } from '@/constants/theme';

type StatCardProps = {
  label: string;
  value: string;
  icon: IconName;
  /**
   * The §1.4 accent: `sales` (net sales, green), `orders` (blue), `average`
   * (average ticket, purple), `stock` (low / out of stock, orange). Only for
   * those meanings; every other figure leaves it out and stays neutral.
   */
  accent?: StatAccentKey | null;
  /** One line under the value. */
  footnote?: string | null;
  testID?: string;
  /** The value's test ID (default `<testID>-value`). */
  valueTestID?: string;
  /** The footnote's test ID (default `<testID>-detail`). */
  footnoteTestID?: string;
  /** An optional quiet action under the footnote (e.g. the reorder level's **Edit**). */
  action?: ReactNode;
};

/**
 * A stat card (MASTER §3): a white card with 20 dp padding, a 36 dp icon
 * square in the accent tint, the label in `muted-text`, the value at 26 / 700
 * in the accent colour (tabular), and a one-line footnote. No trend badge: the
 * API gives no comparison figure (Q-041).
 */
export const StatCard = memo(function StatCard({ label, value, icon, accent = null, footnote, testID, valueTestID, footnoteTestID, action }: StatCardProps) {
  const tone = accent ? statAccent[accent] : null;
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.inner} accessible accessibilityLabel={`${label}: ${value}${footnote ? `, ${footnote}` : ''}`}>
        <View style={[styles.icon, { backgroundColor: tone ? tone.tint : colors.accent }]}>
          <Icon name={icon} size={iconSizes.md} color={tone ? tone.color : colors.textResting} />
        </View>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <Text
          style={[styles.value, { color: tone ? tone.color : colors.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          testID={valueTestID ?? (testID ? `${testID}-value` : undefined)}
        >
          {value}
        </Text>
        {footnote ? (
          <Text style={styles.footnote} numberOfLines={1} testID={footnoteTestID ?? (testID ? `${testID}-detail` : undefined)}>
            {footnote}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: spacing.xl,
  },
  inner: {
    gap: spacing.xs,
  },
  icon: {
    width: sizes.statIcon,
    height: sizes.statIcon,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  value: {
    ...typography.kpiValue,
  },
  footnote: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  action: {
    alignItems: 'flex-start',
    marginTop: spacing.xs,
  },
});
