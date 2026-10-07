import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import type { ChartCardProps } from '@/components/dashboard/DashboardCharts';
import { SectionCard } from '@/components/dashboard/SectionCard';
import { chart, colors, numeric, radius, spacing, typography } from '@/constants/theme';
import { paymentMethodsChart, salesTrendChart } from '@/hooks/dashboard/dashboardModel';
import type { DashboardSales } from '@/services/types';
import { formatPeso } from '@/utils/money';
import { formatCount } from '@/utils/numbers';

/** Progress bar thickness (Top items). */
const BAR_HEIGHT = spacing.xs + spacing.xxs;

/** Net sales for each of the last 7 business days (one series, bars with money end labels). */
export const SalesTrendCard = memo(function SalesTrendCard({ sales, showTable, onToggleTable }: { sales: DashboardSales } & ChartCardProps) {
  const model = useMemo(() => salesTrendChart(sales), [sales]);
  const onToggle = useCallback(() => onToggleTable('salesTrend'), [onToggleTable]);
  return (
    <SectionCard
      title="Net sales, last 7 days"
      subtitle="Completed sales per business day"
      tableToggle={{ showTable, onToggle }}
      testID="chart-card-sales-trend"
    >
      <HorizontalBarChart
        series={model.series}
        rows={model.rows}
        domain={model.domain}
        valueLabelReserve={chart.moneyLabelReserve}
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        testID="chart-sales-trend"
      />
    </SectionCard>
  );
});

/** Today's takings by payment method (cash, GCash), net of change. */
export const PaymentMethodsCard = memo(function PaymentMethodsCard({ sales, showTable, onToggleTable }: { sales: DashboardSales } & ChartCardProps) {
  const model = useMemo(() => paymentMethodsChart(sales), [sales]);
  const onToggle = useCallback(() => onToggleTable('paymentMethods'), [onToggleTable]);
  return (
    <SectionCard title="Payments today" subtitle="Amounts kept, after change" tableToggle={{ showTable, onToggle }} testID="chart-card-payments">
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
 * "Top items today" (Sage "Dashboard"): up to 5, by quantity sold, in the
 * server's order. Each row: rank and name, then "n sold" and net sales, and a
 * thin bar of its quantity relative to the best seller.
 */
export const TopProductsList = memo(function TopProductsList({ sales }: { sales: DashboardSales }) {
  const top = useMemo(() => Math.max(1, ...sales.top_products.map((product) => product.qty)), [sales.top_products]);
  return (
    <SectionCard title="Top items today" testID="dashboard-top-products">
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
    backgroundColor: colors.primary,
  },
});
