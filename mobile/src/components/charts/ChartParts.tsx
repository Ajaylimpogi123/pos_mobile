import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { chart, colors, numeric, radius, shadows, sizes, spacing, typography } from '@/constants/theme';

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export type LegendItem = {
  key: string;
  label: string;
  color: string;
  /** Optional value shown after the label (e.g. a count). */
  value?: string;
};

type LegendProps = {
  items: readonly LegendItem[];
  /** Makes each entry pressable (e.g. to select a donut slice). */
  onPressItem?: (key: string) => void;
  selectedKey?: string | null;
  testID?: string;
};

/**
 * Series legend, placed above the plot. The swatch carries the colour; the
 * text always uses text tokens (never the series colour).
 */
export function Legend({ items, onPressItem, selectedKey = null, testID }: LegendProps) {
  return (
    <View style={styles.legend} testID={testID}>
      {items.map((item) => {
        const content = (
          <>
            <View style={[styles.swatch, { backgroundColor: item.color }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {item.label}
            </Text>
            {item.value !== undefined ? <Text style={styles.legendValue}>{item.value}</Text> : null}
          </>
        );
        if (!onPressItem) {
          return (
            <View key={item.key} style={styles.legendItem} testID={testID ? `${testID}-${item.key}` : undefined}>
              {content}
            </View>
          );
        }
        const selected = selectedKey === item.key;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.value !== undefined ? `${item.label}: ${item.value}` : item.label}
            accessibilityState={{ selected }}
            onPress={() => onPressItem(item.key)}
            testID={testID ? `${testID}-${item.key}` : undefined}
            style={({ pressed }) => [
              styles.legendItem,
              styles.legendPressable,
              (pressed || selected) && styles.legendPressed,
            ]}
          >
            {content}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

export type TableData = {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

/** The chart's numbers as a simple table (the "View as table" alternative). */
export function DataTable({ columns, rows, testID }: TableData & { testID?: string }) {
  return (
    <View style={styles.table} testID={testID} accessibilityRole="list">
      <View style={[styles.tableRow, styles.tableHeader]}>
        {columns.map((column, index) => (
          <Text key={column} style={[styles.headerCell, index > 0 && styles.numeric]} numberOfLines={2}>
            {column}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View
          key={`${row[0]}-${rowIndex}`}
          style={[styles.tableRow, rowIndex < rows.length - 1 && styles.rowDivider]}
          accessible
          accessibilityLabel={row.map((cell, index) => `${columns[index]}: ${cell}`).join(', ')}
          testID={testID ? `${testID}-row-${rowIndex}` : undefined}
        >
          {row.map((cell, index) => (
            <Text key={`${columns[index]}`} style={[styles.cell, index > 0 && styles.numeric]} numberOfLines={2}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tooltip (the mobile equivalent of hover)
// ---------------------------------------------------------------------------

export type TooltipRow = { label: string; value: string; color?: string };

export type TooltipContent = {
  title: string;
  rows: readonly TooltipRow[];
  /** Anchor inside the plot, in px. */
  x: number;
  y: number;
};

type TooltipProps = {
  content: TooltipContent;
  /** The plot's measured size (the tooltip is clamped inside its width). */
  plotWidth: number;
  plotHeight: number;
  onDismiss: () => void;
  testID?: string;
};

/**
 * A small popover with the exact values of the tapped mark. It opens below
 * the anchor in the plot's upper half and above it in the lower half, and is
 * clamped to the plot's width. Tapping it dismisses it.
 */
export function ChartTooltip({ content, plotWidth, plotHeight, onDismiss, testID }: TooltipProps) {
  const width = Math.min(chart.tooltipMaxWidth, plotWidth);
  const left = Math.min(Math.max(0, content.x - width / 2), Math.max(0, plotWidth - width));
  const placement =
    content.y < plotHeight / 2 ? { top: content.y + spacing.sm } : { bottom: plotHeight - content.y + spacing.sm };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${content.title}. ${content.rows.map((row) => `${row.label}: ${row.value}`).join('. ')}. Tap to dismiss.`}
      accessibilityLiveRegion="polite"
      onPress={onDismiss}
      style={[styles.tooltip, { width, left }, placement]}
      testID={testID}
    >
      <Text style={styles.tooltipTitle} numberOfLines={2}>
        {content.title}
      </Text>
      {content.rows.map((row) => (
        <View key={row.label} style={styles.tooltipRow}>
          {row.color ? <View style={[styles.swatch, { backgroundColor: row.color }]} /> : null}
          <Text style={styles.tooltipLabel} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={styles.tooltipValue}>{row.value}</Text>
        </View>
      ))}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Frame: legend + measured plot (or the table)
// ---------------------------------------------------------------------------

export type PlotSize = { width: number; height: number };

type ChartFrameProps = {
  /** Summary of the data for screen readers. */
  accessibilityLabel: string;
  legend?: ReactNode;
  showTable: boolean;
  table: TableData;
  /** Draws the plot at the measured width (never a fixed width). */
  children: (size: PlotSize) => ReactNode;
  testID: string;
};

/**
 * Shared chart frame: the legend above the plot, then the plot sized by
 * `onLayout` (so it re-lays out on rotation), or the data table when
 * "View as table" is on.
 */
export function ChartFrame({ accessibilityLabel, legend, showTable, table, children, testID }: ChartFrameProps) {
  const [size, setSize] = useState<PlotSize>({ width: 0, height: 0 });

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      Math.round(current.width) === Math.round(width) && Math.round(current.height) === Math.round(height)
        ? current
        : { width, height },
    );
  }

  if (showTable) return <DataTable {...table} testID={`${testID}-table`} />;

  return (
    <View style={styles.frame} testID={testID}>
      {legend}
      <View
        onLayout={onLayout}
        style={styles.plot}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        testID={`${testID}-plot`}
      >
        {size.width > 0 ? children(size) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
  },
  legendPressable: {
    minHeight: sizes.iconButton.md,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
  legendPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  swatch: {
    width: chart.swatchSize,
    height: chart.swatchSize,
    borderRadius: radius.sm / 2,
  },
  legendLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  legendValue: {
    ...typography.captionStrong,
    color: colors.text,
  },
  table: {
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tableHeader: {
    backgroundColor: colors.background,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.border,
  },
  rowDivider: {
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  headerCell: {
    ...typography.tableHeader,
    color: colors.textSecondary,
    flex: 1,
  },
  cell: {
    ...typography.bodySm,
    color: colors.text,
    flex: 1,
  },
  numeric: {
    ...numeric,
    textAlign: 'right',
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.lg,
  },
  tooltipTitle: {
    ...typography.label,
    color: colors.text,
  },
  tooltipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tooltipLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  tooltipValue: {
    ...typography.captionStrong,
    color: colors.text,
  },
  frame: {
    gap: spacing.md,
  },
  plot: {
    width: '100%',
  },
});
