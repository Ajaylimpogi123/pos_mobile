import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { IconButton } from '@/components/ui/IconButton';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { RANGE_PRESETS, type ReportRangeState } from '@/hooks/reports/useReportRange';
import { GROUP_BY_OPTIONS, type SalesReportState } from '@/hooks/reports/useSalesReport';
import { useResponsive } from '@/hooks/useResponsive';
import { formatBusinessDate } from '@/utils/dates';

type ReportFiltersProps = {
  range: ReportRangeState;
  /** The view's own filters under the range (e.g. Group by, or category and status). */
  children?: ReactNode;
};

function DateStepper({
  label,
  value,
  onEarlier,
  onLater,
  canLater,
  testID,
}: {
  label: string;
  value: string;
  onEarlier: () => void;
  onLater: () => void;
  canLater: boolean;
  testID: string;
}) {
  return (
    <View style={styles.stepperBox}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <IconButton icon="chevron-back" variant="soft" accessibilityLabel={`${label}: a day earlier`} onPress={onEarlier} testID={`${testID}-earlier`} />
        <Text style={styles.stepperValue} numberOfLines={1} accessibilityLiveRegion="polite" testID={testID}>
          {formatBusinessDate(value)}
        </Text>
        <IconButton
          icon="chevron-forward"
          variant="soft"
          accessibilityLabel={`${label}: a day later`}
          onPress={onLater}
          disabled={!canLater}
          testID={`${testID}-later`}
        />
      </View>
    </View>
  );
}

/**
 * The report's filters: a date range (presets, or From / To a day at a time;
 * never past today, at most 366 days), then the view's own filters. From and
 * To sit side by side on wide screens and stack on phones.
 */
export function ReportFilters({ range: report, children }: ReportFiltersProps) {
  const { isPhone, isPortrait } = useResponsive();
  const stacked = isPhone && isPortrait;
  if (!report.range) return null;

  return (
    <Card style={styles.card} testID="report-filters">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {RANGE_PRESETS.map((preset) => (
          <ChoiceChip
            key={preset.key}
            label={preset.label}
            selected={report.preset === preset.key}
            onPress={() => report.choosePreset(preset.key)}
            testID={`report-preset-${preset.key}`}
          />
        ))}
      </ScrollView>
      <View style={[styles.range, stacked && styles.rangeStacked]}>
        <DateStepper
          label="From"
          value={report.range.from}
          onEarlier={report.fromEarlier}
          onLater={report.fromLater}
          canLater={report.canMoveFromLater}
          testID="report-from"
        />
        <DateStepper
          label="To"
          value={report.range.to}
          onEarlier={report.toEarlier}
          onLater={report.toLater}
          canLater={report.canMoveToLater}
          testID="report-to"
        />
      </View>
      {children}
    </Card>
  );
}

/** A labelled row of choice chips (a single choice), for a report's own filters. */
export function FilterChipRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  testIDPrefix,
  scroll = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Test IDs: `<prefix>-<value>`. */
  testIDPrefix: string;
  /** One scrolling row (long lists, e.g. categories) instead of wrapping. */
  scroll?: boolean;
}) {
  const { isPhone, isPortrait } = useResponsive();
  const inline = !(isPhone && isPortrait);
  const chips = options.map((option) => (
    <ChoiceChip
      key={String(option.value)}
      label={option.label}
      selected={value === option.value}
      onPress={() => onChange(option.value)}
      size="compact"
      tone="soft"
      testID={`${testIDPrefix}-${option.value}`}
    />
  ));
  return (
    <View style={[styles.filter, inline && styles.filterInline]}>
      <Text style={[styles.groupLabel, inline && styles.groupLabelInline]}>{label}</Text>
      {scroll ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={inline ? styles.fill : undefined}
          contentContainerStyle={styles.chips}
          accessibilityRole="radiogroup"
        >
          {chips}
        </ScrollView>
      ) : (
        <View style={[styles.groups, inline && styles.fill]} accessibilityRole="radiogroup">
          {chips}
        </View>
      )}
    </View>
  );
}

/** The sales view's `group_by` selector. */
export function SalesGroupByFilter({ report }: { report: SalesReportState }) {
  return (
    <FilterChipRow
      label="Group by"
      options={GROUP_BY_OPTIONS}
      value={report.groupBy}
      onChange={report.setGroupBy}
      testIDPrefix="report-group"
    />
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  range: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  rangeStacked: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  stepperBox: {
    flex: 1,
    gap: spacing.xs,
  },
  stepperLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperValue: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  filter: {
    gap: spacing.md,
  },
  filterInline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fill: {
    flex: 1,
  },
  /** Inline ("Group by  [Day] [Product] …"): a fixed label column, so the pill rows line up. */
  groupLabelInline: {
    ...typography.label,
    textTransform: 'none',
    width: layout.reportTextColumnWidth - spacing.xl,
  },
  groupLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  groups: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
