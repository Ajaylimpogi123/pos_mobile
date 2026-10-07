import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ChartFrame, ChartTooltip, Legend, type LegendItem, type TableData } from '@/components/charts/ChartParts';
import { donutSlices, sliceAt } from '@/components/charts/chartMath';
import { chart, colors, opacity, typography } from '@/constants/theme';
import { formatCount } from '@/utils/numbers';

export type DonutDatum = {
  key: string;
  label: string;
  value: number;
  color: string;
};

type DonutChartProps = {
  data: readonly DonutDatum[];
  /** Text under the total in the centre, e.g. "staff". */
  centerLabel: string;
  accessibilityLabel: string;
  showTable: boolean;
  table: TableData;
  testID: string;
};

/**
 * A donut: one slice per non-zero value with a 2px surface gap between
 * slices, the total in the centre, and a legend with each count (so identity
 * and values never rely on colour alone). Zero values stay in the legend but
 * draw no slice. Tapping a slice (or its legend entry) shows its exact value.
 */
export const DonutChart = memo(function DonutChart({ data, centerLabel, accessibilityLabel, showTable, table, testID }: DonutChartProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = data.reduce((sum, datum) => sum + datum.value, 0);

  const legendItems: LegendItem[] = data.map((datum) => ({
    key: datum.key,
    label: datum.label,
    color: datum.color,
    value: formatCount(datum.value),
  }));

  function toggle(key: string) {
    setSelected((current) => (current === key ? null : key));
  }

  return (
    <ChartFrame
      accessibilityLabel={accessibilityLabel}
      legend={<Legend items={legendItems} onPressItem={toggle} selectedKey={selected} testID={`${testID}-legend`} />}
      showTable={showTable}
      table={table}
      testID={testID}
    >
      {({ width }) => {
        const size = Math.min(width, chart.donutMaxSize);
        const outer = size / 2;
        const inner = Math.max(0, outer - chart.donutThickness);
        const center = { cx: size / 2, cy: size / 2 };
        const geometry = { ...center, outer, inner };
        const slices = donutSlices(
          data.map((datum) => datum.value),
          { ...geometry, gapPx: chart.gap },
        );
        const offsetX = (width - size) / 2;
        const selectedDatum = data.find((datum) => datum.key === selected) ?? null;

        function onPress(event: GestureResponderEvent) {
          const { locationX, locationY } = event.nativeEvent;
          const slice = sliceAt(slices, locationX, locationY, geometry);
          if (slice) toggle(data[slice.index].key);
          else setSelected(null);
        }

        const percent = selectedDatum && total > 0 ? Math.round((selectedDatum.value * 100) / total) : 0;
        // Anchor the tooltip on the middle of the selected slice's outer edge (the centre for a zero slice).
        const selectedSlice = selectedDatum ? slices.find((slice) => data[slice.index].key === selectedDatum.key) : undefined;
        const midAngle = selectedSlice ? (selectedSlice.startAngle + selectedSlice.endAngle) / 2 : null;
        const anchor =
          midAngle === null
            ? { x: width / 2, y: size / 2 }
            : { x: offsetX + center.cx + outer * Math.sin(midAngle), y: center.cy - outer * Math.cos(midAngle) };

        return (
          <View style={{ height: size }}>
            <Pressable
              onPress={onPress}
              style={[styles.donut, { width: size, height: size, left: offsetX }]}
              testID={`${testID}-hit`}
            >
              <Svg width={size} height={size}>
                {slices.length === 0 ? (
                  // Nothing to show yet: an empty track so the chart still reads as a donut.
                  <Path
                    d={`M ${center.cx} ${center.cy - outer} A ${outer} ${outer} 0 1 1 ${center.cx} ${center.cy + outer} A ${outer} ${outer} 0 1 1 ${center.cx} ${center.cy - outer} Z M ${center.cx} ${center.cy - inner} A ${inner} ${inner} 0 1 0 ${center.cx} ${center.cy + inner} A ${inner} ${inner} 0 1 0 ${center.cx} ${center.cy - inner} Z`}
                    fill={chart.grid}
                    fillRule="evenodd"
                  />
                ) : null}
                {slices.map((slice) => (
                  <Path
                    key={data[slice.index].key}
                    d={slice.path}
                    fill={data[slice.index].color}
                    fillRule="evenodd"
                    opacity={selected && selected !== data[slice.index].key ? opacity.dimmed : 1}
                    testID={`${testID}-slice-${data[slice.index].key}`}
                  />
                ))}
              </Svg>
              <View style={styles.center} pointerEvents="none">
                <Text style={styles.total} testID={`${testID}-total`}>
                  {formatCount(total)}
                </Text>
                <Text style={styles.centerLabel}>{centerLabel}</Text>
              </View>
            </Pressable>
            {selectedDatum ? (
              <ChartTooltip
                content={{
                  title: selectedDatum.label,
                  rows: [
                    { label: 'Count', value: formatCount(selectedDatum.value), color: selectedDatum.color },
                    { label: 'Share', value: `${percent}%` },
                  ],
                  x: anchor.x,
                  y: anchor.y,
                }}
                plotWidth={width}
                plotHeight={size}
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
  donut: {
    position: 'absolute',
    top: 0,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: {
    ...typography.display,
    color: colors.text,
  },
  centerLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
