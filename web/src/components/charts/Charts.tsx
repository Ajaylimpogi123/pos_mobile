/**
 * The Recharts charts of the dashboard and the reports (the legacy
 * `revenue-area-chart`, `top-products-chart` and `payment-methods-chart`
 * look, on the MASTER tokens): one y-axis, the series colours in their fixed
 * order, a custom tooltip per datum, and a legend for 2+ series. Each datum
 * carries its own tooltip text, formatted from integers at render.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import { ChartLegend, TooltipBox, type TooltipRow } from '@/components/charts/chartParts';
import {
  AREA_FILL_OPACITY,
  AXIS_TICK,
  GRID_STROKE,
  REFERENCE_STROKE,
  SERIES_COLORS,
  type ChartSeries,
  type SeriesSlot,
} from '@/components/charts/chartTheme';

/** One point (trend) or one bar row: its axis label, a value per series key, and its tooltip. */
export type ChartDatum = {
  key: string;
  label: string;
  values: Readonly<Record<string, number | null>>;
  tooltip: { title: string; rows: readonly TooltipRow[] };
};

function DatumTooltip({ active, payload }: TooltipContentProps) {
  const datum = payload?.[0]?.payload as ChartDatum | undefined;
  if (!active || !datum) return null;
  return <TooltipBox title={datum.tooltip.title} rows={datum.tooltip.rows} />;
}

function valueOf(key: string) {
  return (datum: ChartDatum) => datum.values[key] ?? null;
}

type TrendChartProps = {
  data: readonly ChartDatum[];
  series: readonly ChartSeries[];
  formatTick: (value: number) => string;
  height?: number;
};

/** An area chart over business days (fills at 18 %), one y-axis, a legend for 2+ series. */
export function TrendChart({ data, series, formatTick, height = 240 }: TrendChartProps) {
  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data as ChartDatum[]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={AXIS_TICK} minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} tickFormatter={formatTick} allowDecimals={false} />
          <Tooltip content={DatumTooltip} cursor={{ stroke: GRID_STROKE }} />
          {series.map((item) => (
            <Area
              key={item.key}
              type="monotone"
              dataKey={valueOf(item.key)}
              name={item.label}
              stroke={SERIES_COLORS[item.slot]}
              strokeWidth={2}
              fill={SERIES_COLORS[item.slot]}
              fillOpacity={AREA_FILL_OPACITY}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {series.length > 1 ? <ChartLegend items={series.map((item) => ({ label: item.label, slot: item.slot }))} /> : null}
    </div>
  );
}

type BarsChartProps = {
  data: readonly ChartDatum[];
  series: readonly ChartSeries[];
  formatTick: (value: number) => string;
  /** Stack the series in one bar per row. */
  stacked?: boolean;
  /** A dashed reference line on the value axis (e.g. the margin target). */
  reference?: { value: number; label: string };
  domain?: [number, number];
  /** Width of the category labels. */
  labelWidth?: number;
  /** A legend with figures (e.g. amounts and shares) instead of the plain one. */
  legend?: readonly { label: string; slot: SeriesSlot; value?: string }[];
};

/** Horizontal bars, one row per datum (top products, categories, roles). */
export function BarsChart({ data, series, formatTick, stacked = false, reference, domain, labelWidth = 120, legend }: BarsChartProps) {
  const height = Math.max(96, data.length * 36 + 40);
  const legendItems = legend ?? (series.length > 1 ? series.map((item) => ({ label: item.label, slot: item.slot })) : null);
  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data as ChartDatum[]} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
          <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={formatTick} domain={domain} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} width={labelWidth} interval={0} />
          <Tooltip content={DatumTooltip} cursor={{ fill: 'var(--accent)' }} />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={valueOf(item.key)}
              name={item.label}
              fill={SERIES_COLORS[item.slot]}
              stackId={stacked ? 'stack' : undefined}
              radius={stacked && index < series.length - 1 ? 0 : [0, 4, 4, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          ))}
          {reference ? (
            <ReferenceLine
              x={reference.value}
              stroke={REFERENCE_STROKE}
              strokeDasharray="4 4"
              label={{ value: reference.label, position: 'top', fill: 'var(--muted-text)', fontSize: 12 }}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
      {legendItems ? <ChartLegend items={legendItems} /> : null}
    </div>
  );
}
