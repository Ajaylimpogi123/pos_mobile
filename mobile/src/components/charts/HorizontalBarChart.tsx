import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import {
  ChartFrame,
  ChartTooltip,
  Legend,
  type LegendItem,
  type TableData,
  type TooltipContent,
  type TooltipRow,
} from '@/components/charts/ChartParts';
import { barPath, linearScale, stackedSegments } from '@/components/charts/chartMath';
import { chart, colors, spacing, typography } from '@/constants/theme';

/** `legendValue`: shown beside the legend label (e.g. "₱3,000.00 · 74%"). */
export type BarSeries = { key: string; label: string; color: string; legendValue?: string };

export type BarRow = {
  key: string;
  label: string;
  /**
   * One value per series (stacked in series order, from the baseline), or
   * `null` when the row has no data: it then shows `noDataLabel` instead of a bar.
   * Only a single-series chart may hold negative values.
   */
  values: readonly number[] | null;
  /** Direct label at the bar's end (e.g. "2/3" or "55.0%"). */
  endLabel: string;
  /** Exact values shown when the row is tapped. */
  tooltip: { title: string; rows: readonly TooltipRow[] };
};

type HorizontalBarChartProps = {
  series: readonly BarSeries[];
  rows: readonly BarRow[];
  /** Value domain of the axis (min ≤ 0 ≤ max). */
  domain: { min: number; max: number };
  /** A dashed reference line with a muted label, e.g. a target. */
  reference?: { value: number; label: string };
  /** Shown instead of a bar for rows with `values: null`. */
  noDataLabel?: string;
  /** Room kept after the longest bar for its end label (wider for money: `chart.moneyLabelReserve`). */
  valueLabelReserve?: number;
  accessibilityLabel: string;
  showTable: boolean;
  table: TableData;
  testID: string;
};

const ROW = chart.rowMinHeight;
const REFERENCE_LABEL_HEIGHT = chart.referenceLabelHeight;

/**
 * Horizontal bars, one row per category, stacked when there are several
 * series. Thin bars with a 4px rounded data-end, square at the baseline, and
 * a 2px surface gap between stacked segments. The category label sits left
 * of the bar; the value is direct-labelled at the bar's end. Each row is a
 * ≥ 44px tap target that opens a tooltip with the exact values.
 */
export const HorizontalBarChart = memo(function HorizontalBarChart({
  series,
  rows,
  domain,
  reference,
  noDataLabel = 'No data',
  valueLabelReserve = chart.valueLabelReserve,
  accessibilityLabel,
  showTable,
  table,
  testID,
}: HorizontalBarChartProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const legendItems: LegendItem[] = series.map((entry) => ({ key: entry.key, label: entry.label, color: entry.color, value: entry.legendValue }));
  const legend = series.length >= 2 ? <Legend items={legendItems} testID={`${testID}-legend`} /> : null;

  return (
    <ChartFrame
      accessibilityLabel={accessibilityLabel}
      legend={legend}
      showTable={showTable}
      table={table}
      testID={testID}
    >
      {({ width, height }) => {
        const labelWidth = Math.round(width * chart.labelShare);
        const barArea = Math.max(0, width - labelWidth - spacing.sm);
        const range = Math.max(0, barArea - valueLabelReserve);
        const scale = linearScale(domain.min, domain.max, range);
        const zeroX = scale(0);
        const top = reference ? REFERENCE_LABEL_HEIGHT : 0;
        const referenceX = reference ? scale(reference.value) : null;
        const barY = (ROW - chart.barThickness) / 2;

        /** Where a row's bar ends (px from the bar area's left edge). */
        function endOf(values: readonly number[] | null): number {
          if (!values) return zeroX;
          if (values.length === 1 && values[0] < 0) return scale(values[0]);
          return zeroX + (scale(1) - scale(0)) * values.reduce((sum, value) => sum + Math.max(0, value), 0);
        }

        const selectedIndex = rows.findIndex((row) => row.key === selected);
        const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;
        const tooltip: TooltipContent | null = selectedRow
          ? {
              title: selectedRow.tooltip.title,
              rows: selectedRow.tooltip.rows,
              x: labelWidth + spacing.sm + endOf(selectedRow.values),
              y: top + selectedIndex * ROW + ROW / 2,
            }
          : null;

        const rowViews = rows.map((row) => {
          const isSelected = selected === row.key;
          const endX = endOf(row.values);
          let marks = null;

          if (row.values) {
            if (row.values.length === 1 && row.values[0] < 0) {
              marks = (
                <Path d={barPath(zeroX, endX, barY, chart.barThickness, chart.barRadius)} fill={series[0].color} />
              );
            } else {
              const unit = scale(1) - scale(0);
              const segments = stackedSegments(row.values, unit, chart.gap);
              marks = segments.map((segment) => (
                <Path
                  key={segment.index}
                  d={barPath(zeroX + segment.x, zeroX + segment.x + segment.width, barY, chart.barThickness, chart.barRadius, segment.isEnd)}
                  fill={series[segment.index]?.color ?? chart.other}
                  testID={`${testID}-bar-${row.key}-${series[segment.index]?.key ?? segment.index}`}
                />
              ));
            }
          }

          const labelLeft = row.values && row.values.length === 1 && row.values[0] < 0 ? zeroX : endX;

          return (
            <Pressable
              key={row.key}
              onPress={() => setSelected(isSelected ? null : row.key)}
              style={[styles.row, isSelected && styles.rowSelected]}
              testID={`${testID}-row-${row.key}`}
            >
              <Text style={[styles.rowLabel, { width: labelWidth }]} numberOfLines={2}>
                {row.label}
              </Text>
              <View style={{ width: barArea, height: ROW }}>
                <Svg width={barArea} height={ROW}>
                  <Line x1={zeroX} x2={zeroX} y1={0} y2={ROW} stroke={chart.axis} strokeWidth={chart.gridWidth} />
                  {referenceX !== null ? (
                    <Line
                      x1={referenceX}
                      x2={referenceX}
                      y1={0}
                      y2={ROW}
                      stroke={chart.axisLabel}
                      strokeWidth={chart.gridWidth}
                      strokeDasharray={chart.referenceDash}
                    />
                  ) : null}
                  {marks}
                </Svg>
                <Text
                  style={[styles.endLabel, row.values ? styles.valueText : styles.noDataText, { left: labelLeft + chart.valueLabelGap }]}
                  numberOfLines={1}
                  testID={`${testID}-label-${row.key}`}
                >
                  {row.values ? row.endLabel : noDataLabel}
                </Text>
              </View>
            </Pressable>
          );
        });

        return (
          <View>
            {reference && referenceX !== null ? (
              <View style={[styles.referenceRow, { marginLeft: labelWidth + spacing.sm, width: barArea }]}>
                <Svg width={barArea} height={REFERENCE_LABEL_HEIGHT} style={StyleSheet.absoluteFill}>
                  <Line
                    x1={referenceX}
                    x2={referenceX}
                    y1={typography.caption.lineHeight}
                    y2={REFERENCE_LABEL_HEIGHT}
                    stroke={chart.axisLabel}
                    strokeWidth={chart.gridWidth}
                    strokeDasharray={chart.referenceDash}
                  />
                </Svg>
                <Text
                  style={[styles.referenceLabel, { left: Math.max(0, Math.min(referenceX - chart.referenceLabelWidth / 2, barArea - chart.referenceLabelWidth)) }]}
                  numberOfLines={1}
                  testID={`${testID}-reference`}
                >
                  {reference.label}
                </Text>
              </View>
            ) : null}
            {rowViews}
            {tooltip ? (
              <ChartTooltip
                content={tooltip}
                plotWidth={width}
                plotHeight={height || top + rows.length * ROW}
                onDismiss={() => setSelected(null)}
                testID={`${testID}-tooltip`}
              />
            ) : null}
          </View>
        );
      }}
    </ChartFrame>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: ROW,
  },
  rowSelected: {
    backgroundColor: colors.surfaceMuted,
  },
  rowLabel: {
    ...typography.bodySm,
    color: colors.text,
  },
  endLabel: {
    position: 'absolute',
    top: (ROW - typography.caption.lineHeight) / 2,
    right: 0,
  },
  valueText: {
    ...typography.captionStrong,
    color: colors.text,
  },
  noDataText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  referenceRow: {
    height: REFERENCE_LABEL_HEIGHT,
  },
  referenceLabel: {
    ...typography.caption,
    color: chart.axisLabel,
    position: 'absolute',
    top: 0,
    width: chart.referenceLabelWidth,
    textAlign: 'center',
  },
});
