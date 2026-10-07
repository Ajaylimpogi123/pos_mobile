import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { IconBadgeTone } from '@/components/ui/IconBadge';
import { colors, iconSizes, numeric, radius, sizes, spacing, typography } from '@/constants/theme';

type InfoCardProps = {
  title: string;
  icon: IconName;
  tone?: IconBadgeTone;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The soft icon tile of each tone (rounded square, like the Settings rows). */
const TILES: Record<IconBadgeTone, { background: string; icon: string }> = {
  primary: { background: colors.primarySoft, icon: colors.primary },
  danger: { background: colors.dangerSoft, icon: colors.danger },
  info: { background: colors.infoSoft, icon: colors.info },
};

/** A flat white card: a soft rounded icon tile + a heading, then its content. */
export function InfoCard({ title, icon, tone = 'primary', children, style, testID }: InfoCardProps) {
  const tile = TILES[tone];
  return (
    <Card style={[styles.card, style]} testID={testID}>
      <View style={styles.header}>
        <View style={[styles.tile, { backgroundColor: tile.background }]}>
          <Icon name={icon} size={iconSizes.md} color={tile.icon} />
        </View>
        <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </Card>
  );
}

type DetailRowProps = {
  label: string;
  value: string;
  testID?: string;
};

/** An uppercase label over its value (tabular digits). Long values wrap to two lines, then ellipsize. */
export function DetailRow({ label, value, testID }: DetailRowProps) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2} ellipsizeMode="tail" testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tile: {
    width: sizes.badge.md,
    height: sizes.badge.md,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  detail: {
    gap: spacing.xxs,
  },
  detailLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  detailValue: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
});
