import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateFilterBar } from '@/components/shared/DateFilterBar';
import { ListHeader } from '@/components/shared/ListHeader';
import { ShiftCard, shiftFlagLabel, varianceText, varianceVariant } from '@/components/shifts/ShiftCard';
import { Chip } from '@/components/ui/Chip';
import { CellText, DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Screen } from '@/components/ui/Screen';
import { shiftRoute } from '@/constants/routes';
import { colors, layout, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { useShiftListScreen } from '@/hooks/shifts/useShifts';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage, isApiError } from '@/services/api';
import type { Shift } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime, formatBranchTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';

function openShift(shift: Shift) {
  router.push(shiftRoute(shift.ulid));
}

function shiftKey(shift: Shift): string {
  return shift.ulid;
}

function rowTestID(shift: Shift): string {
  return `shift-card-${shift.ulid}`;
}

/** The table's columns (landscape): tablet, when, who, status and variance, net sales. */
function useShiftColumns(timeZone: string): DataTableColumn<Shift>[] {
  return useMemo(() => {
    const when = (shift: Shift) => {
      const opened = formatBranchDateTime(shift.opened_at, timeZone) ?? shift.opened_at;
      const closed = shift.closed_at ? formatBranchTime(shift.closed_at, timeZone) : null;
      return closed ? `${opened} – ${closed}` : `Since ${opened}`;
    };
    return [
      {
        key: 'device',
        header: 'Tablet',
        flex: 0.7,
        render: (shift) => (
          <View style={styles.device}>
            <Text style={styles.deviceText} numberOfLines={1}>
              {shift.device.code}
            </Text>
          </View>
        ),
      },
      {
        key: 'when',
        header: 'Shift',
        flex: 1.8,
        render: (shift) => (
          <View>
            <CellText variant="strong">{when(shift)}</CellText>
            <CellText variant="muted">
              Opened by {shift.opened_by.name}
              {shift.closed_by ? ` · Closed by ${shift.closed_by.name}` : ''}
            </CellText>
          </View>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        flex: 1.6,
        render: (shift) => {
          const variance = varianceText(shift.report.variance_cents);
          return (
            <View style={styles.chips}>
              <Chip
                label={shift.status === 'open' ? 'Open' : 'Closed'}
                variant={shift.status === 'open' ? 'processing' : 'completed'}
                testID={`shift-card-${shift.ulid}-status`}
              />
              {variance ? (
                <Chip label={variance} variant={varianceVariant(shift.report.variance_cents)} testID={`shift-card-${shift.ulid}-variance`} />
              ) : null}
              {shift.flags.map((flag) => (
                <Chip key={flag} label={shiftFlagLabel(flag)} variant="caution" />
              ))}
            </View>
          );
        },
      },
      {
        key: 'net',
        header: 'Net sales',
        flex: 1,
        align: 'right',
        render: (shift) => (
          <CellText variant="strong" align="right" style={styles.net} testID={`shift-card-${shift.ulid}-net`}>
            {formatPeso(shift.report.net_sales_cents)}
          </CellText>
        ),
      },
    ];
  }, [timeZone]);
}

/**
 * Shifts (`report.zread`): every tablet's shifts from the server, for one
 * business date (today by default) or every date, newest first.
 * MASTER §6 / back-office.md: the band carries the title and the branch and
 * business date; the date bar sits in a white card over it; the table shows
 * in landscape and the cards in portrait; skeleton rows on first load, empty
 * and error (with Retry) states, pull-to-refresh, and the "Showing n" footer
 * with **Load more** (also loaded on scroll). Tapping a shift opens its report.
 */
export function ShiftListScreen() {
  const screen = useShiftListScreen();
  const { grid, items } = screen.list;
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const columns = useShiftColumns(timeZone);
  const { gutter, screenPaddingX, screenPaddingY, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { onRefresh } = grid;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);
  const renderCard = useCallback((shift: Shift) => <ShiftCard shift={shift} onPress={openShift} />, []);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
  );

  let empty;
  if (screen.allDates) empty = <EmptyState title="No shifts yet" message="Shifts opened on the tablets show here." icon="time-outline" refreshControl={refreshControl} testID="shifts-grid-empty" />;
  else if (screen.isToday) {
    empty = (
      <EmptyState
        title="No shifts today"
        message="A shift shows here once a tablet opens one and syncs."
        icon="time-outline"
        refreshControl={refreshControl}
        testID="shifts-grid-empty"
      />
    );
  } else {
    empty = (
      <EmptyState
        title="No shifts on this day"
        message="Try another day, or show all dates."
        icon="calendar-outline"
        actionLabel="Show all dates"
        onAction={screen.showAllDates}
        refreshControl={refreshControl}
        testID="shifts-grid-empty"
      />
    );
  }

  function loadMore() {
    if (grid.hasNextPage && !grid.isFetchingNextPage && !grid.nextPageError) grid.fetchNextPage();
  }

  let body;
  if (items.length === 0 && grid.error) {
    const noAccess = isApiError(grid.error) && grid.error.status === 403;
    body = (
      <ErrorState
        title={noAccess ? 'No access' : "Couldn't load this list"}
        icon={noAccess ? 'lock-closed-outline' : 'cloud-offline-outline'}
        message={getErrorMessage(grid.error)}
        onRetry={grid.onRetry}
        refreshControl={refreshControl}
        testID="shifts-grid-error"
      />
    );
  } else {
    body = (
      <DataTable
        columns={columns}
        rows={items}
        keyExtractor={shiftKey}
        onRowPress={openShift}
        rowAccessibilityLabel={(shift) => `Shift on ${shift.device.code}, ${shift.status}, net sales ${formatPeso(shift.report.net_sales_cents)}`}
        rowAccessibilityHint="Opens the shift report"
        rowTestID={rowTestID}
        rowHeight="auto"
        renderCard={renderCard}
        cardsInPortrait
        pagination={{
          shown: items.length,
          hasNextPage: grid.hasNextPage,
          isFetchingNextPage: grid.isFetchingNextPage,
          nextPageError: grid.nextPageError,
          fetchNextPage: grid.fetchNextPage,
        }}
        loading={grid.loading && items.length === 0}
        empty={empty}
        ListHeaderComponent={grid.updating ? <ActivityIndicator color={colors.primaryBright} testID="shifts-grid-updating" /> : null}
        refreshControl={refreshControl}
        onEndReached={loadMore}
        contentContainerStyle={[
          styles.content,
          {
            maxWidth: contentMaxWidth,
            paddingHorizontal: screenPaddingX,
            paddingTop: gutter,
            paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
          },
        ]}
        testID="shifts-grid"
      />
    );
  }

  return (
    <Screen edges={[]} testID="shift-list-screen">
      <ListHeader band subtitle="Cash shifts of every tablet" title="Shifts" testIDPrefix="shifts" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <View style={[styles.toolbar, { marginHorizontal: screenPaddingX, maxWidth: contentMaxWidth }]} testID="shifts-toolbar">
          <DateFilterBar
            businessDate={screen.businessDate}
            isToday={screen.isToday}
            allDates={screen.allDates}
            canGoNext={screen.canGoNext}
            onPrevious={screen.previousDay}
            onNext={screen.nextDay}
            onToday={screen.showToday}
            onAllDates={screen.showAllDates}
            testIDPrefix="shifts"
          />
        </View>
        {body}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  /** The date bar: a white card over the band. */
  toolbar: {
    alignSelf: 'stretch',
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  device: {
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  deviceText: {
    ...typography.label,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  net: {
    color: colors.green,
  },
});
