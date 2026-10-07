import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { IconButton } from '@/components/ui/IconButton';
import { colors, hitTarget, layout, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { formatBusinessDate } from '@/utils/dates';

type DateFilterBarProps = {
  /** The selected business date, or `null` for every date. */
  businessDate: string | null;
  isToday: boolean;
  allDates: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onAllDates: () => void;
  testIDPrefix: string;
};

/**
 * A business-date filter: a white ‹ day › stepper (never past today), plus
 * "Today" and "All dates" pills. Business days follow the branch's day start
 * (like Orders). Landscape and tablets: one row; phone portrait: stacked. The
 * same elements keep their tree positions in both (only styles change).
 */
export function DateFilterBar({
  businessDate,
  isToday,
  allDates,
  canGoNext,
  onPrevious,
  onNext,
  onToday,
  onAllDates,
  testIDPrefix,
}: DateFilterBarProps) {
  const { screenPaddingX, contentMaxWidth, isLandscape, isTablet, isCompactHeight } = useResponsive();
  const wide = isLandscape || isTablet;
  let label = 'All dates';
  if (businessDate) label = isToday ? `Today · ${formatBusinessDate(businessDate)}` : formatBusinessDate(businessDate);

  return (
    <View
      style={[
        styles.container,
        wide ? styles.containerWide : styles.containerStacked,
        { paddingHorizontal: screenPaddingX, maxWidth: contentMaxWidth, paddingTop: isCompactHeight ? spacing.sm : spacing.md },
      ]}
      testID={`${testIDPrefix}-date-bar`}
    >
      <View style={[styles.stepper, wide && styles.stepperWide]}>
        <IconButton
          icon="chevron-back"
          variant="ghost"
          accessibilityLabel="Previous day"
          onPress={onPrevious}
          disabled={allDates}
          testID={`${testIDPrefix}-prev-day`}
        />
        <Text style={styles.label} numberOfLines={1} accessibilityLiveRegion="polite" testID={`${testIDPrefix}-date`}>
          {label}
        </Text>
        <IconButton
          icon="chevron-forward"
          variant="ghost"
          accessibilityLabel="Next day"
          onPress={onNext}
          disabled={!canGoNext}
          testID={`${testIDPrefix}-next-day`}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <ChoiceChip label="Today" icon="today-outline" selected={isToday} onPress={onToday} testID={`${testIDPrefix}-today`} />
        <ChoiceChip
          label="All dates"
          icon="calendar-outline"
          selected={allDates}
          onPress={onAllDates}
          testID={`${testIDPrefix}-all-dates`}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignSelf: 'center',
    gap: spacing.sm,
  },
  containerWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  containerStacked: {
    flexDirection: 'column',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: hitTarget.primary,
    paddingHorizontal: spacing.xxs,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepperWide: {
    flex: 1,
    maxWidth: layout.searchMaxWidth,
  },
  label: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
