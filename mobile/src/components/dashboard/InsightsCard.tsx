import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionCard } from '@/components/dashboard/SectionCard';
import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, radius, sizes, spacing, status, typography } from '@/constants/theme';
import { insightTarget, SEVERITY_META } from '@/hooks/dashboard/dashboardModel';
import type { AuthUser, Insight, InsightSeverity } from '@/services/types';

type InsightsCardProps = {
  insights: readonly Insight[];
  user: AuthUser | null;
};

/** The dot (status colour) and the severity word (its AA text shade): never colour alone. */
const SEVERITY_LOOK: Record<InsightSeverity, { dot: string; text: string }> = {
  critical: { dot: status.cancelled.color, text: status.cancelled.text },
  warning: { dot: status.caution.color, text: status.caution.text },
  info: { dot: status.processing.color, text: status.processing.text },
};

/** The status dot in an insight row: 10 dp. */
const DOT = sizes.statusDot + sizes.borderWidthFocus;

function InsightRow({ insight, user }: { insight: Insight; user: AuthUser | null }) {
  const meta = SEVERITY_META[insight.severity];
  const look = SEVERITY_LOOK[insight.severity];
  const target = insightTarget(insight.action, user);

  const content = (
    <>
      <View style={[styles.dot, { backgroundColor: look.dot }]} />
      <View style={styles.text}>
        <Text style={styles.title}>{insight.title}</Text>
        <Text style={styles.message}>
          <Text style={[styles.severity, { color: look.text }]} testID={`insight-${insight.key}-severity`}>
            {meta.label}
          </Text>
          {` · ${insight.message}`}
        </Text>
      </View>
      {target ? <Icon name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} /> : null}
    </>
  );

  return (
    <View testID={`insight-${insight.key}`}>
      {target ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${meta.label}: ${insight.title}. ${insight.message}`}
          accessibilityHint={target.label}
          onPress={() => router.push(target.route)}
          testID={`insight-${insight.key}-action`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          {content}
        </Pressable>
      ) : (
        <View style={styles.row} accessible accessibilityLabel={`${meta.label}: ${insight.title}. ${insight.message}`}>
          {content}
        </View>
      )}
    </View>
  );
}

/**
 * "Needs attention" (Sage "Dashboard"): the server's insights in its order
 * (critical → warning → info). Each is a soft row: a dot in the status
 * colour, the title, the severity word and the advice, and a chevron when it
 * opens a screen the user can use (the whole row is the button).
 */
export const InsightsCard = memo(function InsightsCard({ insights, user }: InsightsCardProps) {
  return (
    <SectionCard
      title="Needs attention"
      subtitle={insights.length > 0 ? `${insights.length} to review` : undefined}
      testID="dashboard-insights"
    >
      {insights.length === 0 ? (
        <View style={styles.empty} testID="dashboard-insights-empty">
          <Icon name="checkmark-circle" size={iconSizes.lg} color={colors.success} />
          <Text style={styles.emptyText}>All clear — nothing needs attention.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {insights.map((insight) => (
            <InsightRow key={insight.key} insight={insight} user={user} />
          ))}
        </View>
      )}
    </SectionCard>
  );
});

const styles = StyleSheet.create({
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    flex: 1,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    minHeight: hitTarget.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + spacing.xxs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.control,
    color: colors.text,
  },
  message: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  severity: {
    ...typography.captionStrong,
  },
});
