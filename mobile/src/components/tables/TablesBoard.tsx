import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import {
  BOARD_DINE_IN_OFF,
  elapsedLabel,
  guestsLabel,
  LONG_SEAT_MINUTES,
  minutesSince,
  NO_AREA_LABEL,
  PENDING_NOTE,
  RESERVATION_STATUS_LABELS,
  tableLabel,
  TABLES_OFFLINE_MESSAGE,
} from '@/components/tables/tableLabels';
import { tableTileModel } from '@/components/tables/tableTileModel';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { Chip } from '@/components/ui/Chip';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatCard } from '@/components/ui/StatCard';
import { tabRoute } from '@/constants/routes';
import { colors, layout, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { useBranchTime } from '@/hooks/tables/useBranchTime';
import { BOARD_SORT_LABELS, type BoardSortKey, type TablesBoardState } from '@/hooks/tables/useTablesBoard';
import { useNow } from '@/hooks/useNow';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { Reservation, TablesSummary, TableView } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

const CLOCK_MS = 30_000;
const SORT_KEYS: readonly BoardSortKey[] = ['open', 'unpaid', 'last_round', 'table', 'status', 'guests', 'opened_by'];

function billsLabel(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'bill' : 'bills'}`;
}

/** The four stat cards (§D): they wrap side by side on tablets and stack on phones. */
function BoardStats({ summary, now }: { summary: TablesSummary; now: number }) {
  const { isPhone } = useResponsive();
  const oldest = summary.oldest_open;
  return (
    <View style={styles.stats}>
      <View style={[styles.stat, isPhone && styles.statFull]}>
        <StatCard
          label="Occupied"
          value={`${formatCount(summary.tables_occupied)} / ${formatCount(summary.tables_total)}`}
          icon="restaurant-outline"
          accent="orders"
          footnote={`${formatCount(summary.tables_reserved)} reserved · ${formatCount(summary.tables_free)} free`}
          testID="board-stat-occupied"
        />
      </View>
      <View style={[styles.stat, isPhone && styles.statFull]}>
        <StatCard label="Guests seated" value={formatCount(summary.guests_seated)} icon="people-outline" testID="board-stat-guests" />
      </View>
      <View style={[styles.stat, isPhone && styles.statFull]}>
        <StatCard
          label="Pending payments"
          value={formatPeso(summary.pending_cents)}
          icon="receipt-outline"
          accent="sales"
          footnote={`${billsLabel(summary.pending_bills)} · ${PENDING_NOTE}`}
          testID="board-stat-pending"
        />
      </View>
      <View style={[styles.stat, isPhone && styles.statFull]}>
        <StatCard
          label="Oldest bill"
          value={oldest ? `${tableLabel(oldest.table_name)} · ${elapsedLabel(minutesSince(oldest.opened_at, now))}` : 'None open'}
          icon="time-outline"
          testID="board-stat-oldest"
        />
      </View>
    </View>
  );
}

function SinceCell({ iso, now, amberAfter }: { iso: string | null; now: number; amberAfter?: number }) {
  if (!iso) return <Text style={styles.muted}>—</Text>;
  const minutes = minutesSince(iso, now);
  const amber = amberAfter !== undefined && minutes >= amberAfter;
  return <Text style={[styles.cell, amber && styles.amber]}>{elapsedLabel(minutes)}</Text>;
}

/** One row as a card (phones and tablet portrait). */
function BoardCard({ table, now, time, onPress }: { table: TableView; now: number; time: (iso: string) => string; onPress: ((table: TableView) => void) | null }) {
  const model = tableTileModel(table, now, time);
  const tab = table.tab;
  const body = (
    <>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {tableLabel(table.name)}
          <Text style={styles.muted}> · {table.area ?? NO_AREA_LABEL}</Text>
        </Text>
        <Chip label={model.statusLabel} variant={model.chip} size="sm" />
      </View>
      {tab ? (
        <>
          <Text style={styles.amount}>{formatPeso(tab.remaining_cents)}</Text>
          <Text style={styles.meta}>
            {guestsLabel(tab.guests)} · {tab.opened_by.name} · open{' '}
            <Text style={model.long ? styles.amber : undefined}>{elapsedLabel(model.minutes)}</Text>
            {tab.last_round_at ? ` · last round ${elapsedLabel(minutesSince(tab.last_round_at, now))} ago` : ''}
          </Text>
        </>
      ) : null}
      {model.reservedBadge ? <Chip label={model.reservedBadge} variant="pending" size="sm" /> : null}
    </>
  );
  if (!onPress || !tab) {
    return (
      <View style={styles.card} accessible accessibilityLabel={model.accessibilityLabel} testID={`board-card-${table.id}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      accessibilityHint="Opens the bill"
      onPress={() => onPress(table)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`board-card-${table.id}`}
    >
      {body}
    </Pressable>
  );
}

function UpcomingReservations({ rows, time }: { rows: readonly Reservation[]; time: (iso: string) => string }) {
  return (
    <View style={styles.upcoming} testID="board-upcoming">
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Upcoming reservations · {rows.length}
      </Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No more bookings today.</Text>
      ) : (
        rows.map((reservation) => (
          <View key={reservation.ulid} style={styles.upcomingRow} testID={`board-upcoming-${reservation.ulid}`}>
            <Text style={styles.upcomingTime}>{time(reservation.reserved_for)}</Text>
            <Text style={styles.upcomingText} numberOfLines={2}>
              {reservation.guest_name} · {guestsLabel(reservation.party_size)} · {tableLabel(reservation.table.name)}
            </Text>
            {reservation.is_late ? <Chip label="Late" variant="warning" size="sm" /> : <Chip label={RESERVATION_STATUS_LABELS[reservation.status]} variant="info" size="sm" />}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * Tables → **Board** (Table Management §D; `report.view`): the stat cards,
 * the table list (sortable by any column, **Unpaid only**; a row opens its
 * bill with `sale.create`) and today's upcoming reservations (readable with
 * `report.view`, Q-051). The table in landscape; cards in portrait and on phones.
 */
export function TablesBoard({ board, canSell, dineIn }: { board: TablesBoardState; canSell: boolean; dineIn: boolean }) {
  const { screenPaddingX, screenPaddingY } = useResponsive();
  const now = useNow(CLOCK_MS);
  const { time } = useBranchTime();
  const open = useCallback((table: TableView) => {
    if (table.tab) router.push(tabRoute(table.tab.ulid));
  }, []);
  const onRowPress = canSell ? open : null;

  const columns = useMemo<DataTableColumn<TableView>[]>(
    () => [
      {
        key: 'table',
        header: 'Table',
        flex: 2,
        render: (table) => (
          <View>
            <Text style={styles.cellStrong} numberOfLines={1}>
              {tableLabel(table.name)}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {table.area ?? NO_AREA_LABEL}
            </Text>
          </View>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        flex: 2,
        render: (table) => {
          const model = tableTileModel(table, now, time);
          return (
            <View style={styles.statusCell}>
              <Chip label={model.statusLabel} variant={model.chip} size="sm" />
              {model.reservedBadge ? <Chip label={model.reservedBadge} variant="pending" size="sm" /> : null}
            </View>
          );
        },
      },
      { key: 'guests', header: 'Guests', flex: 1, align: 'right', render: (table) => <Text style={styles.cell}>{table.tab ? formatCount(table.tab.guests) : '—'}</Text> },
      {
        key: 'opened_by',
        header: 'Opened by',
        flex: 2,
        render: (table) => (
          <Text style={styles.cell} numberOfLines={1}>
            {table.tab?.opened_by.name ?? '—'}
          </Text>
        ),
      },
      { key: 'open', header: 'Time open', flex: 2, render: (table) => <SinceCell iso={table.tab?.opened_at ?? null} now={now} amberAfter={LONG_SEAT_MINUTES} /> },
      { key: 'last_round', header: 'Last round', flex: 2, render: (table) => <SinceCell iso={table.tab?.last_round_at ?? null} now={now} /> },
      {
        key: 'unpaid',
        header: 'Unpaid',
        flex: 2,
        align: 'right',
        render: (table) => <Text style={table.tab ? styles.amountCell : styles.muted}>{table.tab ? formatPeso(table.tab.remaining_cents) : '—'}</Text>,
      },
    ],
    [now, time],
  );

  if (!dineIn || board.dineInOff) {
    return <EmptyState title="Dine-in is off" message={BOARD_DINE_IN_OFF} icon="toggle-outline" testID="board-dine-in-off" />;
  }
  if (!board.online) return <EmptyState title={TABLES_OFFLINE_MESSAGE} message="The board shows live bills from the server." icon="cloud-offline-outline" testID="board-offline" />;
  if (board.summary.isPending) return <LoadingState variant="list" message="Loading the board…" testID="board-loading" />;

  const refreshing = board.summary.isRefetching || board.tablesQuery.isRefetching;
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={() => void board.refetch()} />;
  if (board.summary.error && !board.summary.data) {
    return (
      <ErrorState title="Couldn't load the board" message={getErrorMessage(board.summary.error)} onRetry={() => void board.refetch()} refreshControl={refresh} testID="board-error" />
    );
  }
  const summary = board.summary.data;

  const header = (
    <View style={styles.header}>
      {summary ? <BoardStats summary={summary} now={now} /> : null}
      <View style={styles.filters}>
        <View style={styles.chips} accessibilityLabel="Sort by">
          {SORT_KEYS.map((key) => (
            <ChoiceChip
              key={key}
              label={BOARD_SORT_LABELS[key]}
              selected={board.sortKey === key}
              onPress={() => board.sortBy(key)}
              size="compact"
              testID={`board-sort-${key}`}
            />
          ))}
          <IconButton
            icon={board.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
            variant="soft"
            accessibilityLabel={board.direction === 'asc' ? 'Ascending: tap for descending' : 'Descending: tap for ascending'}
            onPress={() => board.sortBy(board.sortKey)}
            testID="board-sort-direction"
          />
        </View>
        <ChoiceChip label="Unpaid only" icon="filter-outline" selected={board.unpaid} onPress={board.toggleUnpaid} size="compact" testID="board-unpaid" />
      </View>
      {board.tablesQuery.error ? <Text style={styles.error}>{getErrorMessage(board.tablesQuery.error)}</Text> : null}
    </View>
  );

  const empty = board.tablesQuery.isPending ? (
    <LoadingState variant="list" message="Loading tables…" testID="board-tables-loading" />
  ) : (
    <EmptyState
      title={board.unpaid ? 'No unpaid bills' : 'No tables yet'}
      message={board.unpaid ? 'Every open bill is paid. Turn off Unpaid only to see every table.' : 'Add tables in the List tab.'}
      icon="restaurant-outline"
      testID="board-empty"
    />
  );

  return (
    <DataTable
      columns={columns}
      rows={board.rows}
      keyExtractor={(table) => String(table.id)}
      onRowPress={onRowPress ?? undefined}
      rowAccessibilityLabel={(table) => tableTileModel(table, now, time).accessibilityLabel}
      rowAccessibilityHint={canSell ? 'Opens the bill' : undefined}
      rowTestID={(table) => `board-row-${table.id}`}
      renderCard={(table) => <BoardCard table={table} now={now} time={time} onPress={onRowPress} />}
      cardsInPortrait
      rowHeight="auto"
      empty={empty}
      extraData={now}
      ListHeaderComponent={header}
      ListFooterComponent={<UpcomingReservations rows={board.upcoming.data ?? []} time={time} />}
      refreshControl={refresh}
      contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingTop: spacing.md, paddingBottom: screenPaddingY }}
      testID="board-table"
    />
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stat: {
    flexGrow: 1,
    flexBasis: layout.boardStatBasis,
  },
  statFull: {
    flexBasis: '100%',
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  cell: {
    ...typography.tableCell,
    color: colors.text,
    ...numeric,
  },
  cellStrong: {
    ...typography.controlStrong,
    color: colors.text,
  },
  muted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  amber: {
    color: colors.warningText,
  },
  amountCell: {
    ...typography.controlStrong,
    color: colors.primary,
    ...numeric,
  },
  statusCell: {
    gap: spacing.xxs,
    alignItems: 'flex-start',
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  card: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
    opacity: opacity.pressed,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  amount: {
    ...typography.price,
    color: colors.primary,
  },
  meta: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  upcoming: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.tableRow,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  upcomingTime: {
    ...typography.controlStrong,
    color: colors.text,
    width: layout.reservationTimeWidth,
    ...numeric,
  },
  upcomingText: {
    ...typography.bodySm,
    color: colors.text,
    flex: 1,
  },
});
