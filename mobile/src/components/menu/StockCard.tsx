import { StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/shared/FormSection';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconBadge } from '@/components/ui/IconBadge';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, numeric, spacing, typography } from '@/constants/theme';
import { STOCK_LIMITS, useStockAdjustment, type StockMode } from '@/hooks/menu/useStockAdjustment';
import type { AdminProduct } from '@/services/types';
import { formatCount } from '@pos/core/numbers';

type StockCardProps = {
  /** A `track_stock` product (its `stock_qty` is never null then). */
  product: AdminProduct;
  /** The user has `inventory.adjust`: show "Adjust stock". */
  canAdjust: boolean;
};

const MODES: readonly { value: StockMode; label: string; testID: string }[] = [
  { value: 'add', label: 'Add', testID: 'stock-mode-add' },
  { value: 'remove', label: 'Remove', testID: 'stock-mode-remove' },
  { value: 'count', label: 'Count', testID: 'stock-mode-count' },
];

const QTY_LABELS: Record<StockMode, string> = {
  add: 'Quantity to add',
  remove: 'Quantity to remove',
  count: 'Counted quantity on hand',
};

/**
 * Stock on hand of a `track_stock` product (the caller's branch), with the
 * "Adjust stock" dialog: Add, Remove or Count, and a required reason. The
 * adjustment is sent idempotently with its own ULID (`useStockAdjustment`).
 */
export function StockCard({ product, canAdjust }: StockCardProps) {
  const stock = useStockAdjustment(product);
  const onHand = product.stock_qty ?? 0;

  return (
    <Card style={styles.card} testID="stock-card">
      <View style={styles.header}>
        <IconBadge icon="cube-outline" />
        <View style={styles.headerText}>
          <SectionLabel>Stock</SectionLabel>
          <Text style={styles.subtitle}>On hand in this branch</Text>
        </View>
      </View>
      <Text style={[styles.qty, onHand <= 0 && styles.qtyOut]} testID="stock-on-hand">
        {formatCount(onHand)}
      </Text>
      {stock.notice ? <Banner variant="success" message={stock.notice} testID="stock-notice" /> : null}
      {canAdjust ? (
        <Button title="Adjust stock" leftIcon="swap-vertical-outline" variant="secondary" onPress={stock.open} testID="stock-adjust" />
      ) : null}

      <ConfirmDialog
        visible={stock.visible}
        title="Adjust stock"
        message={`${product.name}: ${formatCount(onHand)} on hand.`}
        confirmLabel={stock.locked ? 'Retry' : 'Save adjustment'}
        icon="cube-outline"
        busy={stock.busy}
        error={stock.banner}
        onConfirm={stock.submit}
        onCancel={stock.cancel}
        testID="stock-dialog"
      >
        <SegmentedControl<StockMode>
          options={MODES}
          value={stock.mode}
          onChange={stock.setMode}
          disabled={stock.busy || stock.locked}
          accessibilityLabel="Adjustment type"
          testID="stock-mode"
        />
        <Input
          label={QTY_LABELS[stock.mode]}
          value={stock.qty}
          onChangeText={(text) => stock.setQty(text.replace(/[^0-9]/g, ''))}
          placeholder={stock.mode === 'count' ? 'e.g. 48' : 'e.g. 24'}
          keyboardType="number-pad"
          maxLength={String(STOCK_LIMITS.maxQty).length}
          error={stock.fieldErrors.qty}
          editable={!stock.busy && !stock.locked}
          testID="stock-qty"
        />
        <Input
          label="Reason"
          value={stock.reason}
          onChangeText={stock.setReason}
          placeholder="e.g. Delivery from supplier"
          maxLength={STOCK_LIMITS.reasonMax}
          error={stock.fieldErrors.reason}
          editable={!stock.busy && !stock.locked}
          testID="stock-reason"
        />
      </ConfirmDialog>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  qty: {
    ...typography.display,
    ...numeric,
    color: colors.text,
  },
  qtyOut: {
    color: colors.dangerText,
  },
});
