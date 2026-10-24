import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, layout, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { PERIOD_OPTIONS } from '@/hooks/dashboard/dashboardPeriod';
import type { DashboardPeriod } from '@/services/types';

export type DashboardPeriodFilterProps = {
  value: DashboardPeriod;
  /** `Today` · `Tue, 14 Oct 2026` · `This month` · `October 2026` · `This year` · `2026`. */
  label: string;
  canGoBack: boolean;
  /** False on the current period (the server's business date). */
  canGoForward: boolean;
  /** Another period is loading (the previous figures stay on screen). */
  loading: boolean;
  setPeriod: (period: DashboardPeriod) => void;
  stepBack: () => void;
  stepForward: () => void;
};

const OPTIONS = PERIOD_OPTIONS.map((option) => ({ ...option, testID: `dashboard-period-${option.value}` }));

const UNIT: Record<DashboardPeriod, string> = { day: 'day', month: 'month', year: 'year' };

/**
 * Dashboard Period Filter (v1.28 §D), in the band: a segmented control
 * `Day · Month · Year` and a date stepper `‹ label ›` on a white surface (so
 * its dark text reads anywhere on the gradient). It wraps under itself on
 * narrow screens; every target is at least 44 dp (48 with its hit slop).
 */
export const DashboardPeriodFilter = memo(function DashboardPeriodFilter({
  value,
  label,
  canGoBack,
  canGoForward,
  loading,
  setPeriod,
  stepBack,
  stepForward,
}: DashboardPeriodFilterProps) {
  return (
    <View style={styles.row} testID="dashboard-period-filter">
      <SegmentedControl
        options={OPTIONS}
        value={value}
        onChange={setPeriod}
        accessibilityLabel="Sales period"
        style={styles.segments}
        testID="dashboard-period"
      />
      <View style={styles.stepper} testID="dashboard-period-stepper">
        <IconButton
          icon="chevron-back"
          variant="ghost"
          accessibilityLabel={`Previous ${UNIT[value]}`}
          onPress={stepBack}
          disabled={!canGoBack}
          testID="dashboard-period-previous"
        />
        <View style={styles.labelBox} accessibilityLiveRegion="polite" accessibilityState={{ busy: loading }}>
          <Text style={styles.label} numberOfLines={1} testID="dashboard-period-label">
            {label}
          </Text>
          {loading ? <ActivityIndicator size="small" color={colors.primaryBright} testID="dashboard-period-loading" /> : null}
        </View>
        <IconButton
          icon="chevron-forward"
          variant="ghost"
          accessibilityLabel={`Next ${UNIT[value]}`}
          onPress={stepForward}
          disabled={!canGoForward}
          testID="dashboard-period-next"
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  segments: {
    flexGrow: 1,
    flexBasis: layout.periodSegmentBasis,
    maxWidth: layout.segmentedMaxWidth,
  },
  stepper: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: sizes.segmentedHeight,
    maxWidth: layout.segmentedMaxWidth,
    paddingHorizontal: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  labelBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    minWidth: layout.periodLabelMinWidth,
  },
  label: {
    ...typography.controlStrong,
    color: colors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
});
