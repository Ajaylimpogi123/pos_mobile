import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import { LineChart } from '@/components/charts/LineChart';
import type { ChartCardProps } from '@/components/dashboard/DashboardCharts';
import { SectionCard } from '@/components/dashboard/SectionCard';
import { chart, colors, numeric, radius, spacing, typography } from '@/constants/theme';
import { paymentMethodsChart, salesTrendChart } from '@/hooks/dashboard/dashboardModel';
import { salesPeriodLabel, trendChartDescription, trendChartTitle } from '@/hooks/dashboard/dashboardPeriod';
import type { DashboardSales } from '@/services/types';
import { formatCompactPesos, formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

/** Progress bar thickness (Top items). */
const BAR_HEIGHT = spacing.xs + spacing.xxs;

/**
 * Net sales over the period's trend (back-office.md: a green area chart, one
 * y-axis, tap for the day or month): the 7 days ending on the chosen day, each
 * day of the month, or each month of the year (v1.28).
 */
export const SalesTrendCard = memo(function SalesTrendCard({ sales, showTable, onToggleTable }: { sales: DashboardSales } & ChartCardProps) {
  const model = useMemo(() => salesTrendChart(sales), [sales]);
  const onToggle = useCallback(() => onToggleTable('salesTrend'), [onToggleTable]);
  return (
    <SectionCard
      title={trendChartTitle(sales)}
      subtitle={trendChartDescription(sales)}
      tableToggle={{ showTable, onToggle }}
      testID="chart-card-sales-trend"
    >
      <LineChart
        series={model.series}
        xLabels={model.xLabels}
        columnTitles={model.columnTitles}
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        formatValue={formatPeso}
        formatTick={formatCompactPesos}
        area
        testID="chart-sales-trend"
      />
    </SectionCard>
  );
});

/** The period's takings by payment method, net of change: one stacked bar and a legend with each amount and share. */
export const PaymentMethodsCard = memo(function PaymentMethodsCard({ sales, showTable, onToggleTable }: { sales: DashboardSales } & ChartCardProps) {
  const model = useMemo(() => paymentMethodsChart(sales), [sales]);
  const onToggle = useCallback(() => onToggleTable('paymentMethods'), [onToggleTable]);
  return (
    <SectionCard
      title="Payment methods"
      subtitle={`${salesPeriodLabel(sales)}, takings net of change.`}
      tableToggle={{ showTable, onToggle }} testID="chart-card-payments">
      <HorizontalBarChart
        series={model.series}
        rows={model.rows}
        domain={model.domain}
        valueLabelReserve={chart.moneyLabelReserve}
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        testID="chart-payments"
      />
    </SectionCard>
  );
});

/**
 * "Top items" over the period (Sage "Dashboard"): up to 5, by quantity sold, in the
 * server's order. Each row: rank and name, then "n sold" and net sales, and a
 * thin bar of its quantity relative to the best seller.
 */
export const TopProductsList = memo(function TopProductsList({ sales }: { sales: DashboardSales }) {
  const top = useMemo(() => Math.max(1, ...sales.top_products.map((product) => product.qty)), [sales.top_products]);
  return (
    <SectionCard title="Top items" subtitle={`${salesPeriodLabel(sales)}, by quantity sold.`} testID="dashboard-top-products">
      <View style={styles.list}>
        {sales.top_products.map((product, index) => (
          <View
            key={product.product_id}
            style={styles.item}
            accessible
            accessibilityLabel={`${index + 1}. ${product.name}: ${formatCount(product.qty)} sold, ${formatPeso(product.net_sales_cents)}`}
            testID={`top-product-${product.product_id}`}
          >
            <View style={styles.line}>
              <Text style={styles.rank}>{index + 1}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {product.name}
              </Text>
              <Text style={styles.qty} numberOfLines={1}>
                {formatCount(product.qty)} sold
              </Text>
              <Text style={styles.sales} numberOfLines={1}>
                {formatPeso(product.net_sales_cents)}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(product.qty / top) * 100}%` }]} />
            </View>
          </View>
        ))}
      </View>
    </SectionCard>
  );
});

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  item: {
    gap: spacing.xs + spacing.xxs,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rank: {
    ...typography.captionStrong,
    ...numeric,
    color: colors.textSecondary,
    minWidth: spacing.md,
  },
  name: {
    ...typography.label,
    color: colors.text,
    flex: 1,
  },
  qty: {
    ...typography.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  sales: {
    ...typography.label,
    ...numeric,
    color: colors.text,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
  },
});
