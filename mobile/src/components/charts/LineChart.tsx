import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ChartFrame, ChartTooltip, Legend, type TableData } from '@/components/charts/ChartParts';
import { linePath, linePoints, niceTicks } from '@/components/charts/chartMath';
import { chart, colors, spacing, typography } from '@/constants/theme';
import { formatCount } from '@/utils/numbers';

export type LineSeries = {
  key: string;
  label: string;
  color: string;
  /** One value per column (same length for every series). */
  values: readonly number[];
  /** Shown beside the legend label, e.g. today's count. */
  legendValue?: string;
};

type LineChartProps = {
  series: readonly LineSeries[];
  /** Short x-axis label per column (e.g. "Mon"). */
  xLabels: readonly string[];
  /** Tooltip title per column (e.g. "Thu, 24 Sep 2026"). */
  columnTitles: readonly string[];
  accessibilityLabel: string;
  showTable: boolean;
  table: TableData;
  testID: string;
  /** Tooltip values (default: counts). Phase 6 reports pass money. */
  formatValue?: (value: number) => string;
  /** Y-axis tick labels (default: counts); must fit the narrow axis. */
  formatTick?: (value: number) => string;
};

const TOP_PAD = spacing.sm;

/**
 * A line chart of counts: every series shares **one** y-axis (never dual
 * axes), with nice integer ticks, recessive gridlines, 2px lines and ≥ 8px
 * markers with a 2px surface ring. Tapping a day column shows a crosshair
 * and a tooltip with each series' exact value.
 */
export const LineChart = memo(function LineChart({
  series,
  xLabels,
  columnTitles,
  accessibilityLabel,
  showTable,
  table,
  testID,
  formatValue = formatCount,
  formatTick = formatCount,
}: LineChartProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const count = xLabels.length;
  const dataMax = Math.max(0, ...series.flatMap((entry) => entry.values));
  const ticks = niceTicks(dataMax);

  const legend =
    series.length >= 2 ? (
      <Legend
        items={series.map((entry) => ({ key: entry.key, label: entry.label, color: entry.color, value: entry.legendValue }))}
        testID={`${testID}-legend`}
      />
    ) : null;

  return (
    <ChartFrame accessibilityLabel={accessibilityLabel} legend={legend} showTable={showTable} table={table} testID={testID}>
      {({ width }) => {
        const plotWidth = Math.max(0, width - chart.yAxisWidth);
        const plotHeight = chart.plotHeight;
        const column = count > 0 ? plotWidth / count : 0;
        const toY = (value: number) => TOP_PAD + plotHeight - (value / ticks.max) * plotHeight;
        const pointsBySeries = series.map((entry) =>
          linePoints(entry.values, plotWidth, plotHeight, ticks.max).map((point) => ({
            x: point.x + chart.yAxisWidth,
            y: point.y + TOP_PAD,
          })),
        );
        const totalHeight = TOP_PAD + plotHeight + chart.xAxisHeight;
        const selectedX = selected !== null ? chart.yAxisWidth + (selected + 0.5) * column : 0;
        const selectedTop =
          selected !== null ? Math.min(...pointsBySeries.map((points) => points[selected]?.y ?? TOP_PAD + plotHeight)) : 0;

        return (
          <View style={{ height: totalHeight }} testID={`${testID}-canvas`}>
            <Svg width={width} height={totalHeight}>
              {ticks.values.map((value) => (
                <Line
                  key={value}
                  x1={chart.yAxisWidth}
                  x2={width}
                  y1={toY(value)}
                  y2={toY(value)}
                  stroke={value === 0 ? chart.axis : chart.grid}
                  strokeWidth={chart.gridWidth}
                />
              ))}
              {selected !== null ? (
                <Line
                  x1={selectedX}
                  x2={selectedX}
                  y1={TOP_PAD}
                  y2={TOP_PAD + plotHeight}
                  stroke={chart.axis}
                  strokeWidth={chart.gridWidth}
                  testID={`${testID}-crosshair`}
                />
              ) : null}
              {series.map((entry, seriesIndex) => (
                <Path
                  key={entry.key}
                  d={linePath(pointsBySeries[seriesIndex])}
                  stroke={entry.color}
                  strokeWidth={chart.lineWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                  testID={`${testID}-line-${entry.key}`}
                />
              ))}
              {series.map((entry, seriesIndex) =>
                pointsBySeries[seriesIndex].map((point, index) => (
                  <Circle
                    key={`${entry.key}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={selected === index ? chart.markerRadiusActive : chart.markerRadius}
                    fill={entry.color}
                    stroke={chart.surface}
                    strokeWidth={chart.markerRing}
                    testID={`${testID}-point-${entry.key}-${index}`}
                  />
                )),
              )}
            </Svg>

            {ticks.values.map((value) => (
              <Text
                key={value}
                style={[styles.yLabel, { top: toY(value) - typography.caption.lineHeight / 2 }]}
                testID={`${testID}-ytick-${value}`}
              >
                {formatTick(value)}
              </Text>
            ))}

            {xLabels.map((label, index) => (
              <Text
                key={`${label}-${index}`}
                style={[
                  styles.xLabel,
                  { left: chart.yAxisWidth + index * column, width: column, top: TOP_PAD + plotHeight + spacing.xs },
                  selected === index && styles.xLabelSelected,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            ))}

            {xLabels.map((label, index) => (
              <Pressable
                key={`hit-${label}-${index}`}
                onPress={() => setSelected(selected === index ? null : index)}
                style={[styles.hit, { left: chart.yAxisWidth + index * column, width: column, height: totalHeight }]}
                testID={`${testID}-column-${index}`}
              />
            ))}

            {selected !== null ? (
              <ChartTooltip
                content={{
                  title: columnTitles[selected] ?? xLabels[selected],
                  rows: series.map((entry) => ({
                    label: entry.label,
                    value: formatValue(entry.values[selected] ?? 0),
                    color: entry.color,
                  })),
                  x: selectedX,
                  y: selectedTop,
                }}
                plotWidth={width}
                plotHeight={totalHeight}
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
  yLabel: {
    ...typography.caption,
    color: chart.axisLabel,
    position: 'absolute',
    left: 0,
    width: chart.yAxisWidth - spacing.xs,
    textAlign: 'right',
  },
  xLabel: {
    ...typography.caption,
    color: chart.axisLabel,
    position: 'absolute',
    textAlign: 'center',
  },
  xLabelSelected: {
    ...typography.captionStrong,
    color: colors.text,
  },
  hit: {
    position: 'absolute',
    top: 0,
  },
});
