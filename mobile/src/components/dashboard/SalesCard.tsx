import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SectionCard } from '@/components/dashboard/SectionCard';
import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, layout, numeric, spacing, typography } from '@/constants/theme';
import type { DashboardSales } from '@/services/types';
import { isCurrentPeriod, noSalesMessage, salesRangeLabel } from '@/hooks/dashboard/dashboardPeriod';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

type SalesCardProps = {
  sales: DashboardSales;
};

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit testID={`${testID}-value`}>
        {value}
      </Text>
    </View>
  );
}

/**
 * The period's sales (the caller's branch, the chosen day / month / year,
 * completed orders; v1.28), from the real `sales` section: net sales in large type, then
 * orders, items sold, the average order, gross sales, discounts and VAT.
 * With no orders yet it says so honestly: no numbers, no sample figures.
 * Voids & Refunds (Phase 7): voided sales, refunds and net after refunds
 * (a refund of an earlier sale still shows on a day with no sales).
 */
export const SalesCard = memo(function SalesCard({ sales }: SalesCardProps) {
  const current = isCurrentPeriod(sales.period, sales.date_from, sales.business_date);
  const today = sales.period === 'day' && current;
  return (
    <SectionCard
      title={today ? 'Sales today' : 'Sales'}
      subtitle={salesRangeLabel(sales)}
      testID="dashboard-sales"
    >
      {sales.orders_count === 0 && (sales.voids_count ?? 0) === 0 && (sales.refunds_cents ?? 0) === 0 ? (
        <View style={styles.empty} testID="dashboard-sales-empty">
          <Icon name="receipt-outline" size={iconSizes.lg} color={colors.textSecondary} />
          <View style={styles.emptyText}>
            <Text style={styles.emptyTitle}>{noSalesMessage(sales.period, current)}</Text>
            <Text style={styles.emptyMessage}>
              {current ? 'Completed sales show here as they happen.' : 'Use the arrows above to see another period.'}
            </Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.headline}>
            <Text style={styles.net} numberOfLines={1} adjustsFontSizeToFit testID="dashboard-sales-net">
              {formatPeso(sales.net_sales_cents)}
            </Text>
            <Text style={styles.netLabel}>Net sales</Text>
          </View>
          <View style={styles.stats}>
            <Stat label="Orders" value={formatCount(sales.orders_count)} testID="sales-orders" />
            <Stat label="Items sold" value={formatCount(sales.items_sold)} testID="sales-items" />
            <Stat label="Average order" value={formatPeso(sales.average_order_cents)} testID="sales-average" />
            <Stat label="Gross sales" value={formatPeso(sales.gross_sales_cents)} testID="sales-gross" />
            <Stat label="Discounts" value={formatPeso(sales.discounts_cents)} testID="sales-discounts" />
            <Stat label="VAT" value={formatPeso(sales.vat_amount_cents)} testID="sales-vat" />
            {/* Senior Citizen / PWD Discount: shown once there is one today. */}
            {(sales.sc_pwd_orders_count ?? 0) > 0 ? (
              <Stat
                label={`SC/PWD (${formatCount(sales.sc_pwd_orders_count)})`}
                value={formatPeso(sales.sc_pwd_discount_cents ?? 0)}
                testID="sales-sc-pwd"
              />
            ) : null}
            {(sales.sc_pwd_vat_relief_cents ?? 0) > 0 ? (
              <Stat label="VAT exempted (SC/PWD)" value={formatPeso(sales.sc_pwd_vat_relief_cents)} testID="sales-sc-pwd-vat" />
            ) : null}
            {/* Dine-in Tables & Tabs: the service charge (part of Net sales), once there is one today. */}
            {(sales.service_charge_cents ?? 0) > 0 ? (
              <Stat label="Service charge" value={formatPeso(sales.service_charge_cents)} testID="sales-service-charge" />
            ) : null}
            {/* Voids & Refunds (Phase 7). */}
            <Stat label="Voided sales" value={formatCount(sales.voids_count ?? 0)} testID="sales-voids" />
            <Stat label="Refunds" value={formatPeso(sales.refunds_cents ?? 0)} testID="sales-refunds" />
            <Stat
              label="Net after refunds"
              value={formatPeso(sales.net_after_refunds_cents ?? sales.net_sales_cents)}
              testID="sales-net-after-refunds"
            />
          </View>
        </>
      )}
    </SectionCard>
  );
});

const styles = StyleSheet.create({
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    flex: 1,
    gap: spacing.xxs,
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  emptyMessage: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  headline: {
    gap: spacing.xxs,
  },
  net: {
    ...typography.display,
    color: colors.primary,
  },
  netLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  stat: {
    flexGrow: 1,
    flexBasis: layout.reportNumberColumnWidth + spacing.giant,
    gap: spacing.xxs,
    paddingRight: spacing.sm,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statValue: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
});
