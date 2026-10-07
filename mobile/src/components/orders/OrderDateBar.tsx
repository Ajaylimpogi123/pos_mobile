import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';

import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { IconButton } from '@/components/ui/IconButton';
import { colors, hitTarget, layout, radius, sizes, spacing, typography } from '@/constants/theme';
import type { useOrderListScreen } from '@/hooks/orders/useOrders';
import { useResponsive } from '@/hooks/useResponsive';
import { ORDER_STATUS_FILTERS, orderStatusLabel } from '@/sale/reversals';
import { formatBusinessDate } from '@/utils/dates';

type OrderDateBarProps = {
  screen: ReturnType<typeof useOrderListScreen>;
};

/**
 * The Orders date selector: ‹ business day › (never past today), plus
 * "Today" and "All dates" chips. Business days follow the branch's day start.
 * Offline Sales (Phase 5): with `order.review`, a "Needs review" chip (every date).
 * Voids & Refunds (Phase 7): a **Status** chip that opens a picker (every
 * status, Completed, Voided, Refunded, Partly refunded).
 */
export function OrderDateBar({ screen }: OrderDateBarProps) {
  const { screenPaddingX, contentMaxWidth, isTablet } = useResponsive();
  const [picking, setPicking] = useState(false);

  let label = screen.needsReview ? 'Needs review · all dates' : 'All dates';
  if (screen.businessDate) {
    label = screen.isToday ? `Today · ${formatBusinessDate(screen.businessDate)}` : formatBusinessDate(screen.businessDate);
  }

  return (
    <View style={[styles.container, isTablet && styles.containerRow, { paddingHorizontal: screenPaddingX, maxWidth: contentMaxWidth }]} testID="orders-date-bar">
      <View style={[styles.stepper, isTablet && styles.stepperRow]}>
        <IconButton
          icon="chevron-back"
          variant="soft"
          accessibilityLabel="Previous day"
          onPress={screen.previousDay}
          disabled={screen.allDates || screen.needsReview}
          testID="orders-prev-day"
        />
        <Text style={styles.label} numberOfLines={1} accessibilityLiveRegion="polite" testID="orders-date">
          {label}
        </Text>
        <IconButton
          icon="chevron-forward"
          variant="soft"
          accessibilityLabel="Next day"
          onPress={screen.nextDay}
          disabled={!screen.canGoNext}
          testID="orders-next-day"
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={isTablet ? styles.chipsRow : undefined} contentContainerStyle={styles.chips}>
        <ChoiceChip
          label="Today"
          icon="today-outline"
          selected={screen.isToday}
          size="compact"
          tone="dark"
          onPress={screen.showToday}
          testID="orders-today"
        />
        <ChoiceChip
          label="All dates"
          icon="calendar-outline"
          selected={screen.allDates}
          size="compact"
          tone="dark"
          onPress={screen.showAllDates}
          testID="orders-all-dates"
        />
        <ChoiceChip
          label={screen.status ? `Status · ${orderStatusLabel(screen.status)}` : 'Status'}
          icon="funnel-outline"
          selected={screen.status !== null}
          size="compact"
          tone="dark"
          onPress={() => setPicking(true)}
          disabled={screen.needsReview}
          testID="orders-status"
        />
        {screen.canReview ? (
          <ChoiceChip
            label="Needs review"
            icon="flag-outline"
            selected={screen.needsReview}
            size="compact"
            tone="dark"
            onPress={screen.toggleNeedsReview}
            testID="orders-needs-review"
          />
        ) : null}
      </ScrollView>
      <DialogFrame visible={picking} onRequestClose={() => setPicking(false)} testID="orders-status-dialog">
        <Text style={styles.title} accessibilityRole="header">
          Status
        </Text>
        <View style={styles.options}>
          <ChoiceChip
            label="Every status"
            selected={screen.status === null}
            onPress={() => {
              screen.setStatus(null);
              setPicking(false);
            }}
            testID="orders-status-all"
          />
          {ORDER_STATUS_FILTERS.map((status) => (
            <ChoiceChip
              key={status}
              label={orderStatusLabel(status)}
              selected={screen.status === status}
              onPress={() => {
                screen.setStatus(status);
                setPicking(false);
              }}
              testID={`orders-status-${status}`}
            />
          ))}
        </View>
        <Button title="Cancel" variant="ghost" onPress={() => setPicking(false)} testID="orders-status-cancel" />
      </DialogFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  containerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: hitTarget.primary + spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepperRow: {
    width: layout.searchMaxWidth - layout.reportNumberColumnWidth,
  },
  chipsRow: {
    flex: 1,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
