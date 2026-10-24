import { router, type Href } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SectionCard } from '@/components/dashboard/SectionCard';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ingredientAlertsRoute, inventoryAlertsRoute } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import type { stockAlerts } from '@/hooks/dashboard/dashboardModel';
import { formatCount } from '@pos/core/numbers';

type StockAlertsCardProps = {
  alerts: ReturnType<typeof stockAlerts>;
  /** The user may open Inventory (its module is visible to them). */
  canOpenInventory: boolean;
};

type Row = { key: 'products' | 'ingredients'; label: string; counts: { out: number; low: number }; to: Href };

/**
 * Stock alerts (back-office.md → Dashboard): products and ingredients with
 * their **Out** and **Low** counts as dot badges, and an "Open inventory" link
 * where there is something to look at. The counts are the server's stock
 * insights (real data only; nothing is computed here).
 */
export const StockAlertsCard = memo(function StockAlertsCard({ alerts, canOpenInventory }: StockAlertsCardProps) {
  const rows: Row[] = [
    { key: 'products', label: 'Products', counts: alerts.products, to: inventoryAlertsRoute() },
    { key: 'ingredients', label: 'Ingredients', counts: alerts.ingredients, to: ingredientAlertsRoute() },
  ];
  return (
    <SectionCard title="Stock alerts" subtitle="Current stock against reorder levels" testID="dashboard-stock-alerts">
      <View style={styles.list}>
        {rows.map((row) => (
          <View key={row.key} style={styles.row} testID={`stock-alerts-${row.key}`}>
            <Text style={styles.label}>{row.label}</Text>
            <Chip label={`Out ${formatCount(row.counts.out)}`} variant="cancelled" testID={`stock-alerts-${row.key}-out`} />
            <Chip label={`Low ${formatCount(row.counts.low)}`} variant="caution" testID={`stock-alerts-${row.key}-low`} />
            <View style={styles.spacer} />
            {canOpenInventory && row.counts.out + row.counts.low > 0 ? (
              <Button
                title="Open inventory"
                variant="ghost"
                onPress={() => router.push(row.to)}
                accessibilityLabel={`Open inventory: ${row.label.toLowerCase()} low or out of stock`}
                testID={`stock-alerts-${row.key}-open`}
              />
            ) : null}
          </View>
        ))}
      </View>
    </SectionCard>
  );
});

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
    minWidth: spacing.huge * 2,
  },
  spacer: {
    flexGrow: 1,
  },
});
