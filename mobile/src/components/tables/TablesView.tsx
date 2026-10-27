import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type ViewToken } from 'react-native';

import { useShell } from '@/components/shell/ShellContext';
import { FloorPlanView } from '@/components/tables/FloorPlanView';
import { OpenTabDialog } from '@/components/tables/OpenTabDialog';
import { ReservationActionDialogs, ReservedTableSheet } from '@/components/tables/ReservationDialogs';
import { elapsedLabel, guestsLabel, seatsLabel, TABLES_OFFLINE_MESSAGE } from '@/components/tables/tableLabels';
import { tableTileModel } from '@/components/tables/tableTileModel';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/LoadingState';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { tablesRoute } from '@/constants/routes';
import { colors, iconSizes, layout, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { useBranchTime } from '@/hooks/tables/useBranchTime';
import { useTablesView } from '@/hooks/tables/useTablesView';
import { useTablesViewPreference } from '@/hooks/tables/useTablesViewPreference';
import { useNow } from '@/hooks/useNow';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { TablesViewPreference } from '@/services/secureStorage';
import type { TableView } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { isPlaced } from '@pos/core/tables/floorPlan';

/** The elapsed time on the cards is refreshed this often. */
const CLOCK_MS = 30_000;
const MAX_COLUMNS = 6;

const VIEW_OPTIONS: readonly SegmentOption<TablesViewPreference>[] = [
  { value: 'floor', label: 'Floor', icon: 'map-outline', testID: 'tables-view-floor' },
  { value: 'grid', label: 'Grid', icon: 'grid-outline', testID: 'tables-view-grid' },
];

type Row =
  | { key: string; kind: 'header'; title: string; count: number }
  | { key: string; kind: 'plan'; tables: TableView[] }
  | { key: string; kind: 'tables'; tables: TableView[] };

type TileProps = { table: TableView; now: number; disabled: boolean; time: (iso: string) => string; onPress: (table: TableView) => void };

/**
 * One table: name, Free / Occupied / Reserved (dot + word), guests, the
 * remaining amount and the elapsed time (amber after 90 min); a reserved one
 * shows the guest and time, an occupied one with a held reservation a `Reserved 7:00 PM` badge.
 */
const TableTile = memo(function TableTile({ table, now, disabled, time, onPress }: TileProps) {
  const model = tableTileModel(table, now, time);
  const tab = table.tab;
  const reservation = table.reservation;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      accessibilityHint={model.accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onPress(table)}
      style={({ pressed }) => [
        styles.tile,
        model.status === 'free' && styles.tileFree,
        model.status === 'occupied' && styles.tileOccupied,
        model.long && styles.tileLong,
        model.status === 'reserved' && styles.tileReserved,
        pressed && styles.tilePressed,
        disabled && styles.disabled,
      ]}
      testID={`table-tile-${table.id}`}
    >
      <View style={styles.tileTop}>
        <Text style={styles.tileName} numberOfLines={1} adjustsFontSizeToFit>
          {table.name}
        </Text>
        <Chip label={model.statusLabel} variant={model.chip} size="sm" />
      </View>
      {tab ? (
        <>
          <Text style={styles.tileAmount} numberOfLines={1} testID={`table-tile-${table.id}-amount`}>
            {formatPeso(tab.remaining_cents)}
          </Text>
          <View style={styles.tileMeta}>
            <Icon name="people-outline" size={iconSizes.sm} color={colors.textSecondary} />
            <Text style={styles.tileMetaText} numberOfLines={1}>
              {guestsLabel(tab.guests)}
            </Text>
            <Icon name="time-outline" size={iconSizes.sm} color={model.long ? colors.warningText : colors.textSecondary} />
            <Text style={[styles.tileMetaText, model.long && styles.longText]} numberOfLines={1} testID={`table-tile-${table.id}-elapsed`}>
              {elapsedLabel(model.minutes)}
            </Text>
          </View>
          {model.reservedBadge ? <Chip label={model.reservedBadge} variant="pending" size="sm" testID={`table-tile-${table.id}-reserved`} /> : null}
        </>
      ) : model.status === 'reserved' && reservation ? (
        <View style={styles.tileMeta}>
          <Icon name="calendar-outline" size={iconSizes.sm} color={colors.pendingText} />
          <Text style={[styles.tileMetaText, styles.reservedText]} numberOfLines={2}>
            {reservation.guest_name} · {guestsLabel(reservation.party_size)} · {time(reservation.reserved_for)}
          </Text>
        </View>
      ) : (
        <View style={styles.tileMeta}>
          <Icon name="people-outline" size={iconSizes.sm} color={colors.textSecondary} />
          <Text style={styles.tileMetaText} numberOfLines={1}>
            {seatsLabel(table.seats)}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

/**
 * **Tables** on Sell (Dine-in Tables & Tabs §I; Table Management §C and §F):
 * each area shows its **floor plan** when one of its tables is placed (the
 * unplaced ones as cards below), or the card grid; a **Floor | Grid** switch
 * (remembered on this device) changes the view. A free table opens a bill
 * (asking for guests); an occupied one opens it; a reserved one opens the
 * reserved sheet. **Reservations** opens today's list. Polled every 15 s
 * while on screen. Offline: `Tables need a connection.` Rotation re-lays out
 * in place and keeps the first visible table in view.
 */
export function TablesView({ active }: { active: boolean }) {
  const view = useTablesView(active);
  const { width, gutter, screenPaddingX, screenPaddingY } = useResponsive();
  const { sidebarWidth } = useShell();
  const now = useNow(CLOCK_MS);
  const { time } = useBranchTime();
  const [preference, setPreference] = useTablesViewPreference();

  const available = width - sidebarWidth - 2 * screenPaddingX;
  const columns = Math.max(2, Math.min(MAX_COLUMNS, Math.floor((available + gutter) / (layout.sellTileMinWidth + gutter))));
  const anyPlaced = useMemo(() => view.tables.some((table) => isPlaced(table)), [view.tables]);
  const floor = preference === 'floor' && anyPlaced;

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const group of view.groups) {
      out.push({ key: `h-${group.key}`, kind: 'header', title: group.title, count: group.items.length });
      const placed = floor ? group.items.filter((table) => isPlaced(table)) : [];
      const cards = placed.length > 0 ? group.items.filter((table) => !isPlaced(table)) : group.items;
      if (placed.length > 0) out.push({ key: `p-${group.key}`, kind: 'plan', tables: placed });
      for (let start = 0; start < cards.length; start += columns) {
        out.push({ key: `r-${group.key}-${start}`, kind: 'tables', tables: cards.slice(start, start + columns) });
      }
    }
    return out;
  }, [view.groups, columns, floor]);

  // Rotation: keep the first visible table in view after the column count changes.
  const listRef = useRef<FlatList<Row>>(null);
  const anchor = useRef<number | null>(null);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
    const first = viewableItems.find((token) => token.item.kind !== 'header');
    if (first && first.item.kind !== 'header') anchor.current = first.item.tables[0]?.id ?? null;
  }, []);
  const lastColumns = useRef(columns);
  useEffect(() => {
    if (lastColumns.current === columns) return;
    lastColumns.current = columns;
    const id = anchor.current;
    if (id === null) return;
    const index = rows.findIndex((row) => row.kind !== 'header' && row.tables.some((table) => table.id === id));
    if (index <= 0) return;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 }));
    return () => cancelAnimationFrame(frame);
  }, [columns, rows]);

  if (!view.online) {
    return (
      <EmptyState
        title={TABLES_OFFLINE_MESSAGE}
        message="Open bills live on the server. Pay now still works offline."
        icon="cloud-offline-outline"
        testID="tables-offline"
      />
    );
  }
  if (view.loading) return <LoadingState variant="grid" message="Loading tables…" testID="tables-view-loading" />;

  const refresh = <RefreshControl refreshing={view.refreshing} onRefresh={() => void view.refetch()} />;
  if (view.error && view.tables.length === 0) {
    return (
      <ErrorState
        title={view.dineInOff ? 'Dine-in is off' : "Couldn't load the tables"}
        message={getErrorMessage(view.error)}
        onRetry={() => void view.refetch()}
        refreshControl={refresh}
        testID="tables-view-error"
      />
    );
  }
  if (view.tables.length === 0) {
    return (
      <EmptyState
        title="No tables yet"
        message="A manager adds the tables in Tables → List."
        icon="restaurant-outline"
        refreshControl={refresh}
        testID="tables-view-empty"
      />
    );
  }

  const toolbar = (
    <View style={styles.toolbar}>
      {anyPlaced ? (
        <SegmentedControl<TablesViewPreference>
          options={VIEW_OPTIONS}
          value={floor ? 'floor' : 'grid'}
          onChange={setPreference}
          size="compact"
          accessibilityLabel="Floor plan or grid"
          style={styles.switch}
          testID="tables-view-mode"
        />
      ) : null}
      <Button
        title="Reservations"
        leftIcon="calendar-outline"
        variant="secondary"
        onPress={() => router.push(tablesRoute('reservations'))}
        accessibilityHint="Opens today's reservations"
        testID="tables-reservations"
      />
    </View>
  );

  return (
    <>
      <FlatList
        ref={listRef}
        key={`tables-${columns}`}
        data={rows}
        keyExtractor={(row) => row.key}
        ListHeaderComponent={toolbar}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <Text style={styles.area} accessibilityRole="header">
                {item.title} · {item.count}
              </Text>
            );
          }
          if (item.kind === 'plan') {
            return (
              <FloorPlanView
                tables={item.tables}
                availableWidth={available}
                now={now}
                disabled={view.opening}
                time={time}
                onPress={view.press}
                testID={`tables-plan-${item.key}`}
              />
            );
          }
          return (
            <View style={[styles.row, { gap: gutter }]}>
              {item.tables.map((table) => (
                <View key={table.id} style={styles.cell}>
                  <TableTile table={table} now={now} disabled={view.opening} time={time} onPress={view.press} />
                </View>
              ))}
              {Array.from({ length: columns - item.tables.length }, (_unused, index) => (
                <View key={`pad-${index}`} style={styles.cell} />
              ))}
            </View>
          );
        }}
        extraData={time}
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
        refreshControl={refresh}
        contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingBottom: screenPaddingY, gap: gutter / 2 }}
        testID="tables-view"
      />
      <OpenTabDialog view={view} />
      <ReservedTableSheet table={view.reserved} actions={view.reservations} time={time} onClose={view.closeReserved} />
      <ReservationActionDialogs actions={view.reservations} time={time} />
    </>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  switch: {
    flexGrow: 1,
    maxWidth: layout.segmentedMaxWidth,
  },
  area: {
    ...typography.overline,
    color: colors.textSecondary,
    paddingTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  tile: {
    minHeight: sizes.skeleton.tile,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    backgroundColor: colors.surface,
  },
  tileFree: {
    borderColor: colors.border,
  },
  tileOccupied: {
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
  },
  tileLong: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  tileReserved: {
    borderStyle: 'dashed',
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.pending,
    backgroundColor: colors.pendingSoft,
  },
  tilePressed: {
    transform: [{ scale: pressedScale }],
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tileName: {
    ...typography.title,
    color: colors.text,
    flexShrink: 1,
  },
  tileAmount: {
    ...typography.price,
    color: colors.primary,
    ...numeric,
  },
  tileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tileMetaText: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginRight: spacing.sm,
    flexShrink: 1,
  },
  longText: {
    color: colors.warningText,
  },
  reservedText: {
    color: colors.pendingText,
  },
});
