import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, layout, pressedScale, radius, spacing, typography } from '@/constants/theme';

type SectionCardProps = {
  title: string;
  subtitle?: string;
  /** A chart card's "View as table" switch. */
  tableToggle?: { showTable: boolean; onToggle: () => void };
  /** Extra header content on the right (before the table toggle). */
  right?: ReactNode;
  children: ReactNode;
  testID: string;
};

/**
 * A dashboard / report section (Sage "Dashboard" cards): a white card with a
 * bold 16 title (and a muted subtitle), an optional "View as table" pill on
 * the right, then the content. The header wraps on narrow cards.
 */
export const SectionCard = memo(function SectionCard({ title, subtitle, tableToggle, right, children, testID }: SectionCardProps) {
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
        {tableToggle ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="View as table"
            accessibilityState={{ checked: tableToggle.showTable }}
            onPress={tableToggle.onToggle}
            testID={`${testID}-table-toggle`}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Icon name={tableToggle.showTable ? 'bar-chart-outline' : 'list-outline'} size={iconSizes.sm} color={colors.primaryDark} />
            <Text style={styles.toggleText}>{tableToggle.showTable ? 'View as chart' : 'View as table'}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  titles: {
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
    gap: spacing.xxs,
  },
  title: {
    ...typography.section,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  toggle: {
    minHeight: hitTarget.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.inner,
    backgroundColor: colors.surfaceMuted,
  },
  togglePressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: pressedScale }],
  },
  toggleText: {
    ...typography.controlStrong,
    color: colors.primaryDark,
  },
});
