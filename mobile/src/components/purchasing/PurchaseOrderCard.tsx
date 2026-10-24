import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { itemNames } from '@/components/purchasing/PurchaseRequestCard';
import { chipFor, PO_RECEIVING_STATUS, PO_STATUS } from '@/components/purchasing/purchasingLabels';
import { Chip } from '@/components/ui/Chip';
import { colors, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import type { PurchaseOrder } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';
import { formatPeso } from '@pos/core/money';

type PurchaseOrderCardProps = {
  po: PurchaseOrder;
  /** Receives the PO, so the list passes one stable handler to the memoized cards. */
  onPress: (po: PurchaseOrder) => void;
  hint: string;
};

/**
 * One purchase order (Sage "Purchasing" board): the PO number with its
 * status (and receiving) chips, a meta line (its PR and the expected
 * delivery), the lines and suppliers, and the total in bold green. The whole
 * card opens it (the detail, or the receive screen).
 */
export const PurchaseOrderCard = memo(function PurchaseOrderCard({ po, onPress, hint }: PurchaseOrderCardProps) {
  const testID = `po-card-${po.ulid}`;
  const status = chipFor(PO_STATUS, po.status);
  const receiving = chipFor(PO_RECEIVING_STATUS, po.receiving_status);
  const suppliers = [...new Set(po.lines.map((line) => line.supplier.name))];
  const count = po.lines.length;

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${po.po_no}, ${status.label}, ${receiving.label}, total ${formatPeso(po.total_cents)}`}
        accessibilityHint={hint}
        onPress={() => onPress(po)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <Text style={styles.number} numberOfLines={1}>
          {po.po_no}
        </Text>
        <View style={styles.chips}>
          <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} />
          {po.status === 'approved' ? <Chip label={receiving.label} variant={receiving.variant} testID={`${testID}-receiving`} /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          From {po.purchase_request.pr_no}
          {po.expected_delivery_date ? ` · Expected ${formatBusinessDate(po.expected_delivery_date)}` : ''}
        </Text>
        <Text style={styles.items} numberOfLines={2}>
          {count} {count === 1 ? 'line' : 'lines'}: {itemNames(po.lines.map((line) => line.item.name))}
        </Text>
        <View style={styles.footer}>
          <Text style={styles.caption} numberOfLines={1}>
            {itemNames(suppliers)}
          </Text>
          <Text style={styles.total} testID={`${testID}-total`}>
            {formatPeso(po.total_cents)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  body: {
    flexGrow: 1,
    gap: spacing.sm,
    paddingVertical: spacing.md + spacing.xxs,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  number: {
    ...typography.bodyStrong,
    fontFamily: typography.heading.fontFamily,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  items: {
    ...typography.control,
    color: colors.text,
  },
  caption: {
    ...typography.captionMedium,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  total: {
    ...typography.price,
    ...numeric,
    color: colors.primary,
  },
});
