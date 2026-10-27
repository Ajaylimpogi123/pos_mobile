import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { FloorPlanGrid, floorBoxStyle, floorCellSize } from '@/components/tables/FloorPlanGrid';
import { elapsedLabel, guestsLabel } from '@/components/tables/tableLabels';
import { tableTileModel } from '@/components/tables/tableTileModel';
import { Chip } from '@/components/ui/Chip';
import { colors, numeric, opacity, pressedScale, sizes, spacing, typography } from '@/constants/theme';
import type { TableView } from '@/services/types';
import { formatPeso } from '@pos/core/money';

/** A tile shows its status word from this width, and the figures from this size (dp). */
const STATUS_MIN_WIDTH = 64;
const DETAIL_MIN_WIDTH = 96;
const DETAIL_MIN_HEIGHT = 88;

type PlanTileProps = {
  table: TableView;
  cell: number;
  now: number;
  disabled: boolean;
  time: (iso: string) => string;
  onPress: (table: TableView) => void;
};

/** One table on the plan, drawn at its cells with the card's colours and contents (as much as fits). */
const PlanTile = memo(function PlanTile({ table, cell, now, disabled, time, onPress }: PlanTileProps) {
  const model = tableTileModel(table, now, time);
  const box = floorBoxStyle(table, cell);
  const boxWidth = Number(box.width);
  const boxHeight = Number(box.height);
  const showStatus = boxWidth >= STATUS_MIN_WIDTH;
  const showDetail = boxWidth >= DETAIL_MIN_WIDTH && boxHeight >= DETAIL_MIN_HEIGHT;
  const tab = table.tab;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      accessibilityHint={model.accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onPress(table)}
      style={({ pressed }) => [
        box,
        styles.tile,
        model.status === 'occupied' && styles.occupied,
        model.long && styles.long,
        model.status === 'reserved' && styles.reserved,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      testID={`plan-table-${table.id}`}
    >
      <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {table.name}
      </Text>
      {showStatus ? <Chip label={model.statusLabel} variant={model.chip} size="sm" /> : null}
      {showDetail && tab ? (
        <>
          <Text style={styles.amount} numberOfLines={1}>
            {formatPeso(tab.remaining_cents)}
          </Text>
          <Text style={[styles.meta, model.long && styles.longText]} numberOfLines={1}>
            {guestsLabel(tab.guests)} · {elapsedLabel(model.minutes)}
          </Text>
        </>
      ) : null}
      {showDetail && model.status === 'reserved' && table.reservation ? (
        <Text style={styles.meta} numberOfLines={2}>
          {table.reservation.guest_name} · {time(table.reservation.reserved_for)}
        </Text>
      ) : null}
      {showDetail && model.reservedBadge ? <Chip label={model.reservedBadge} variant="pending" size="sm" /> : null}
    </Pressable>
  );
});

type FloorPlanViewProps = {
  /** The area's placed tables. */
  tables: readonly TableView[];
  availableWidth: number;
  now: number;
  disabled: boolean;
  time: (iso: string) => string;
  onPress: (table: TableView) => void;
  testID?: string;
};

/**
 * Sell → Tables, one area's **floor plan** (Table Management §C): scaled to
 * the width (phones scroll it sideways), each table at its position and size
 * with the same colours and contents as the cards.
 */
export function FloorPlanView({ tables, availableWidth, now, disabled, time, onPress, testID }: FloorPlanViewProps) {
  const cell = floorCellSize(availableWidth);
  return (
    <FloorPlanGrid cell={cell} availableWidth={availableWidth} testID={testID}>
      {tables.map((table) => (
        <PlanTile key={table.id} table={table} cell={cell} now={now} disabled={disabled} time={time} onPress={onPress} />
      ))}
    </FloorPlanGrid>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    padding: spacing.xs,
    overflow: 'hidden',
    borderWidth: sizes.borderWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  occupied: {
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
  },
  long: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  reserved: {
    borderStyle: 'dashed',
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.pending,
    backgroundColor: colors.pendingSoft,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.text,
    textAlign: 'center',
  },
  amount: {
    ...typography.controlStrong,
    color: colors.primary,
    ...numeric,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  longText: {
    color: colors.warningText,
  },
});
