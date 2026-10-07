import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { chipFor, LINE_STATUS } from '@/components/purchasing/purchasingLabels';
import { FormSection } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { CellText, type DataTableColumn } from '@/components/ui/DataTable';
import { colors, numeric, sizes, spacing, typography } from '@/constants/theme';
import type { GoodsReceipt, PurchaseOrderLine } from '@/services/types';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';
import { formatQtyUnit, toScaled } from '@/utils/quantity';

export function lineTestID(line: PurchaseOrderLine): string {
  return `po-line-${line.id}`;
}

/** `2 sack @ ₱1,200.00`. */
function qtyAtPrice(line: PurchaseOrderLine): string {
  return `${formatQtyUnit(line.qty, line.unit)} @ ${formatPeso(line.unit_price_cents)}`;
}

/** `Received 1 sack · Remaining 1 sack`. */
function receivedText(line: PurchaseOrderLine): string {
  return `Received ${formatQtyUnit(line.received_qty, line.unit)} · Remaining ${formatQtyUnit(line.remaining_qty, line.unit)}`;
}

function NoPrice({ line }: { line: PurchaseOrderLine }) {
  return (
    <Text style={styles.warning} numberOfLines={2} testID={`${lineTestID(line)}-no-price`}>
      No price yet: set one before approving.
    </Text>
  );
}

type LineCardProps = {
  line: PurchaseOrderLine;
  /** Shows **Edit line** (pending orders, `purchase.request` or `purchase.approve`). Receives the line. */
  onEdit?: (line: PurchaseOrderLine) => void;
  disabled?: boolean;
  /** Show the received / remaining quantities (approved orders). */
  showReceiving: boolean;
};

/** Phones: one PO line (item, supplier, `2 sack @ ₱1,200.00`, the total, received / remaining and its status chip). */
export const PurchaseOrderLineCard = memo(function PurchaseOrderLineCard({ line, onEdit, disabled, showReceiving }: LineCardProps) {
  const testID = lineTestID(line);
  const status = chipFor(LINE_STATUS, line.receiving_status);
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={2}>
            {line.item.name}
          </Text>
          <Text style={styles.muted} numberOfLines={1} testID={`${testID}-supplier`}>
            {line.supplier.name}
          </Text>
        </View>
        {showReceiving ? <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} /> : null}
      </View>
      <View style={styles.priceRow}>
        <Text style={styles.body} testID={`${testID}-qty`}>
          {qtyAtPrice(line)}
        </Text>
        <Text style={styles.total} testID={`${testID}-total`}>
          {formatPeso(line.line_total_cents)}
        </Text>
      </View>
      {line.unit_price_cents === 0 ? <NoPrice line={line} /> : null}
      {showReceiving ? (
        <Text style={styles.muted} testID={`${testID}-received`}>
          {receivedText(line)}
        </Text>
      ) : null}
      {onEdit ? (
        <Button title="Edit line" leftIcon="create-outline" variant="secondary" onPress={() => onEdit(line)} disabled={disabled} testID={`${testID}-edit`} />
      ) : null}
    </Card>
  );
});

type LineColumnOptions = {
  wide: boolean;
  showReceiving: boolean;
  onEdit?: (line: PurchaseOrderLine) => void;
  disabled: boolean;
};

/**
 * The PO lines table: item, supplier, `qty @ price`, the line total (with a
 * "no price yet" warning), and on approved orders the received / remaining
 * quantities with the line status; **Edit** while the order is pending.
 * Tablet portrait folds the supplier under the item. Cells keep the card
 * test IDs (`po-line-<id>-qty`, `-total`, `-no-price`, `-supplier`, `-received`, `-status`, `-edit`).
 */
export function usePurchaseOrderLineColumns({ wide, showReceiving, onEdit, disabled }: LineColumnOptions): DataTableColumn<PurchaseOrderLine>[] {
  return useMemo(() => {
    const item: DataTableColumn<PurchaseOrderLine> = {
      key: 'item',
      header: 'Item',
      flex: 1.3,
      render: (line) => (
        <>
          <CellText variant="strong" numberOfLines={2}>
            {line.item.name}
          </CellText>
          {wide ? null : (
            <CellText variant="muted" testID={`${lineTestID(line)}-supplier`}>
              {line.supplier.name}
            </CellText>
          )}
        </>
      ),
    };
    const supplier: DataTableColumn<PurchaseOrderLine> = {
      key: 'supplier',
      header: 'Supplier',
      flex: 1,
      render: (line) => (
        <CellText numberOfLines={2} style={styles.resting} testID={`${lineTestID(line)}-supplier`}>
          {line.supplier.name}
        </CellText>
      ),
    };
    const qty: DataTableColumn<PurchaseOrderLine> = {
      key: 'qty',
      header: 'Qty @ price',
      flex: 1.1,
      align: 'right',
      render: (line) => (
        <CellText align="right" numberOfLines={2} testID={`${lineTestID(line)}-qty`}>
          {qtyAtPrice(line)}
        </CellText>
      ),
    };
    const total: DataTableColumn<PurchaseOrderLine> = {
      key: 'total',
      header: 'Total',
      flex: 0.9,
      align: 'right',
      render: (line) => (
        <>
          <CellText variant="strong" align="right" testID={`${lineTestID(line)}-total`}>
            {formatPeso(line.line_total_cents)}
          </CellText>
          {line.unit_price_cents === 0 ? <NoPrice line={line} /> : null}
        </>
      ),
    };
    const receiving: DataTableColumn<PurchaseOrderLine> = {
      key: 'receiving',
      header: 'Receiving',
      flex: 1.3,
      render: (line) => {
        const status = chipFor(LINE_STATUS, line.receiving_status);
        return (
          <>
            <Chip label={status.label} variant={status.variant} testID={`${lineTestID(line)}-status`} />
            <CellText variant="muted" numberOfLines={2} testID={`${lineTestID(line)}-received`}>
              {receivedText(line)}
            </CellText>
          </>
        );
      },
    };
    const edit: DataTableColumn<PurchaseOrderLine> | null = onEdit
      ? {
          key: 'edit',
          header: '',
          width: sizes.iconButton.lg * 2 + spacing.lg,
          align: 'right',
          render: (line) => (
            <Button
              title="Edit"
              leftIcon="create-outline"
              variant="secondary"
              onPress={() => onEdit(line)}
              disabled={disabled}
              accessibilityLabel={`Edit ${line.item.name}`}
              testID={`${lineTestID(line)}-edit`}
            />
          ),
        }
      : null;
    const columns = wide ? [item, supplier, qty, total] : [item, qty, total];
    if (showReceiving) columns.push(receiving);
    if (edit) columns.push(edit);
    return columns;
  }, [wide, showReceiving, onEdit, disabled]);
}

/** The receiving history (§H `receipts[]`, newest first): who, when, remarks, and each line (a correction shows its reason). */
export const ReceiptHistoryCard = memo(function ReceiptHistoryCard({
  receipts,
  lines,
  timeZone,
}: {
  receipts: readonly GoodsReceipt[];
  lines: readonly PurchaseOrderLine[];
  timeZone: string;
}) {
  const nameOf = new Map(lines.map((line) => [line.id, line.item.name]));
  return (
    <FormSection title="Receipts" testID="po-receipts">
      {receipts.length === 0 ? <Text style={styles.muted}>Nothing received yet.</Text> : null}
      {receipts.map((receipt, index) => (
        <View key={receipt.ulid} style={[styles.receipt, index > 0 && styles.receiptDivided]} testID={`po-receipt-${receipt.ulid}`}>
          <Text style={styles.label}>
            {receipt.received_by ? `${receipt.received_by.name} · ` : ''}
            {formatBranchDateTime(receipt.received_at, timeZone) ?? receipt.received_at}
          </Text>
          {receipt.remarks ? <Text style={styles.muted}>{receipt.remarks}</Text> : null}
          {receipt.lines.map((line, lineIndex) => {
            const correction = (toScaled(line.qty) ?? 0n) < 0n;
            return (
              <Text
                key={`${line.po_line_id}-${lineIndex}`}
                style={[styles.receiptLine, correction && styles.correction]}
                testID={`po-receipt-${receipt.ulid}-line-${lineIndex}`}
              >
                {nameOf.get(line.po_line_id) ?? 'Item'}: {correction ? '' : '+'}
                {formatQtyUnit(line.qty, line.unit)} · {formatPeso(line.cost_cents)}
                {line.reason ? ` · ${line.reason}` : ''}
              </Text>
            );
          })}
        </View>
      ))}
    </FormSection>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  body: {
    ...typography.body,
    ...numeric,
    color: colors.text,
  },
  total: {
    ...typography.price,
    color: colors.primary,
  },
  resting: {
    color: colors.textResting,
  },
  muted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  label: {
    ...typography.control,
    color: colors.text,
  },
  warning: {
    ...typography.captionMedium,
    color: colors.warningText,
  },
  receipt: {
    gap: spacing.xxs,
  },
  receiptDivided: {
    paddingTop: spacing.md,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  receiptLine: {
    ...typography.bodySm,
    ...numeric,
    color: colors.text,
  },
  correction: {
    color: colors.dangerText,
  },
});
