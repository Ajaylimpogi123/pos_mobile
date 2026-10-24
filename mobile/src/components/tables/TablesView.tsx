import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type ViewToken } from 'react-native';

import { useShell } from '@/components/shell/ShellContext';
import { OpenTabDialog } from '@/components/tables/OpenTabDialog';
import {
  elapsedLabel,
  guestsLabel,
  LONG_SEAT_MINUTES,
  minutesSince,
  seatsLabel,
  TABLES_OFFLINE_MESSAGE,
} from '@/components/tables/tableLabels';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, iconSizes, layout, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { useTablesView } from '@/hooks/tables/useTablesView';
import { useNow } from '@/hooks/useNow';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { TableView } from '@/services/types';
import { formatPeso } from '@pos/core/money';

/** The elapsed time on the cards is refreshed this often. */
const CLOCK_MS = 30_000;
const MAX_COLUMNS = 6;

type Row = { key: string; kind: 'header'; title: string; count: number } | { key: string; kind: 'tables'; tables: TableView[] };

type TileProps = { table: TableView; now: number; disabled: boolean; onPress: (table: TableView) => void };

/** One table: name, Free / Occupied (dot + word), guests, the remaining amount and the elapsed time (amber after 90 min). */
const TableTile = memo(function TableTile({ table, now, disabled, onPress }: TileProps) {
  const tab = table.tab;
  const minutes = tab ? minutesSince(tab.opened_at, now) : 0;
  const long = tab !== null && minutes >= LONG_SEAT_MINUTES;
  const status = tab ? 'Occupied' : 'Free';
  const detail = tab
    ? `${guestsLabel(tab.guests)}, ${formatPeso(tab.remaining_cents)}, open ${elapsedLabel(minutes)}`
    : seatsLabel(table.seats);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Table ${table.name}, ${status}, ${detail}`}
      accessibilityHint={tab ? 'Opens the bill' : 'Opens a bill for this table'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onPress(table)}
      style={({ pressed }) => [
        styles.tile,
        tab ? styles.tileOccupied : styles.tileFree,
        long && styles.tileLong,
        pressed && styles.tilePressed,
        disabled && styles.disabled,
      ]}
      testID={`table-tile-${table.id}`}
    >
      <View style={styles.tileTop}>
        <Text style={styles.tileName} numberOfLines={1} adjustsFontSizeToFit>
          {table.name}
        </Text>
        <Chip label={status} variant={tab ? (long ? 'warning' : 'info') : 'success'} size="sm" />
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
            <Icon name="time-outline" size={iconSizes.sm} color={long ? colors.warningText : colors.textSecondary} />
            <Text style={[styles.tileMetaText, long && styles.longText]} numberOfLines={1} testID={`table-tile-${table.id}-elapsed`}>
              {elapsedLabel(minutes)}
            </Text>
          </View>
        </>
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
 * **Tables** on Sell (Dine-in Tables & Tabs §I): cards grouped by area. A
 * free table opens a bill (asking for guests); an occupied one opens it.
 * Polled every 15 s while on screen. Offline: `Tables need a connection.`
 * Columns follow the width (rotation re-lays out in place and keeps the
 * first visible table in view).
 */
export function TablesView({ active }: { active: boolean }) {
  const view = useTablesView(active);
  const { width, gutter, screenPaddingX, screenPaddingY } = useResponsive();
  const { sidebarWidth } = useShell();
  const now = useNow(CLOCK_MS);

  const available = width - sidebarWidth - 2 * screenPaddingX;
  const columns = Math.max(2, Math.min(MAX_COLUMNS, Math.floor((available + gutter) / (layout.sellTileMinWidth + gutter))));

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const group of view.groups) {
      out.push({ key: `h-${group.key}`, kind: 'header', title: group.title, count: group.items.length });
      for (let start = 0; start < group.items.length; start += columns) {
        out.push({ key: `r-${group.key}-${start}`, kind: 'tables', tables: group.items.slice(start, start + columns) });
      }
    }
    return out;
  }, [view.groups, columns]);

  // Rotation: keep the first visible table in view after the column count changes.
  const listRef = useRef<FlatList<Row>>(null);
  const anchor = useRef<number | null>(null);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
    const first = viewableItems.find((token) => token.item.kind === 'tables');
    if (first && first.item.kind === 'tables') anchor.current = first.item.tables[0]?.id ?? null;
  }, []);
  const lastColumns = useRef(columns);
  useEffect(() => {
    if (lastColumns.current === columns) return;
    lastColumns.current = columns;
    const id = anchor.current;
    if (id === null) return;
    const index = rows.findIndex((row) => row.kind === 'tables' && row.tables.some((table) => table.id === id));
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
        message="A manager adds the tables in Settings → Tables."
        icon="restaurant-outline"
        refreshControl={refresh}
        testID="tables-view-empty"
      />
    );
  }

  return (
    <>
      <FlatList
        ref={listRef}
        key={`tables-${columns}`}
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text style={styles.area} accessibilityRole="header">
              {item.title} · {item.count}
            </Text>
          ) : (
            <View style={[styles.row, { gap: gutter }]}>
              {item.tables.map((table) => (
                <View key={table.id} style={styles.cell}>
                  <TableTile table={table} now={now} disabled={view.opening} onPress={view.press} />
                </View>
              ))}
              {Array.from({ length: columns - item.tables.length }, (_unused, index) => (
                <View key={`pad-${index}`} style={styles.cell} />
              ))}
            </View>
          )
        }
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
        refreshControl={refresh}
        contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingBottom: screenPaddingY, gap: gutter / 2 }}
        testID="tables-view"
      />
      <OpenTabDialog view={view} />
    </>
  );
}

const styles = StyleSheet.create({
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
  },
  longText: {
    color: colors.warningText,
  },
});
