import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SalePrintStatus } from '@/components/printing/SalePrintStatus';
import { AmountRow } from '@/components/shared/AmountRow';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  colors,
  iconSizes,
  layout,
  numeric,
  radius,
  shadows,
  sizes,
  spacing,
  status,
  typography,
} from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { isLocalOrder, ticketNumberLabel } from '@/sale/localOrder';
import type { PrintableOrder } from '@/services/types';
import { formatPeso } from '@pos/core/money';

type SaleCompleteProps = {
  order: PrintableOrder;
  /** e.g. "An earlier attempt already completed this sale." (Q-004). */
  note?: string | null;
  onNewSale: () => void;
};

/** The success mark: 72 dp (Sale complete board). */
const MARK_SIZE = sizes.badge.lg + spacing.sm;

/**
 * The success screen (Sale complete board), from the server's `Order`, or,
 * for a sale saved on the tablet (Offline Sales), from the local order (its
 * `order_no`, the kitchen's number `T01-5`, and the note `No connection —
 * sale saved on this tablet.`): a success mark in the completed colour,
 * "Sale complete", the invoice line (invoice · table), the queue number
 * for the kitchen call-out, then a summary (total, tendered) with the
 * **change due** in large type, and "New sale".
 *
 * Printing (Phase 4) runs in the background: below, one status row per job
 * with Retry, the items not sent to any printer, and "Print receipt" when
 * auto-print is off. The screen never waits for a printer.
 */
export function SaleComplete({ order, note, onNewSale }: SaleCompleteProps) {
  const { screenPaddingX, screenPaddingY, isCompactHeight, isPhone } = useResponsive();
  const local = isLocalOrder(order);
  const number = ticketNumberLabel(order);
  const change = formatPeso(order.change_cents);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}
        testID="sale-complete"
      >
        <View style={[styles.card, isPhone ? styles.cardPhone : styles.cardTablet]}>
          {isCompactHeight ? null : (
            <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name="checkmark" size={iconSizes.xl} color={status.completed.color} />
            </View>
          )}
          <View style={styles.titles}>
            <Text style={styles.title} accessibilityRole="header">
              Sale complete
            </Text>
            <View style={styles.invoiceLine} accessible accessibilityLabel={`${local ? 'Order' : 'Invoice'} ${order.invoice_no ?? order.order_no}${order.table_no ? `, table ${order.table_no}` : ''}`}>
              <Text style={styles.invoice} numberOfLines={1} testID="sale-invoice">
                {order.invoice_no ?? order.order_no}
              </Text>
              {order.table_no ? (
                <>
                  <Text style={styles.invoice}>{' · '}</Text>
                  <Text style={styles.invoice} numberOfLines={1} testID="sale-table">
                    Table {order.table_no}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
          {note ? <Banner variant={local ? 'warning' : 'info'} message={note} testID="sale-note" /> : null}
          <View style={styles.queue} accessible accessibilityLabel={`Queue number ${number}`}>
            <Text style={styles.queueLabel}>Queue</Text>
            <Text style={styles.queueValue} numberOfLines={1} adjustsFontSizeToFit testID="sale-queue">
              {number}
            </Text>
          </View>
          <View style={styles.summary}>
            <AmountRow label="Total" cents={order.total_cents} variant="summary" testID="sale-total" />
            <AmountRow label="Tendered" cents={order.tendered_cents} variant="summary" testID="sale-tendered" />
            <View style={styles.divider} />
            <View style={styles.changeRow} accessible accessibilityLabel={`Change due: ${change}`}>
              <Text style={styles.changeLabel}>Change</Text>
              <Text style={styles.changeValue} numberOfLines={1} adjustsFontSizeToFit testID="sale-change">
                {change}
              </Text>
            </View>
          </View>
          <Button title="New sale" leftIcon="add" size="xl" onPress={onNewSale} testID="sale-new" />
          <SalePrintStatus order={order} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: layout.formMaxWidth,
    alignItems: 'stretch',
    gap: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.lg,
  },
  cardTablet: {
    padding: spacing.huge,
  },
  cardPhone: {
    padding: spacing.xl,
  },
  mark: {
    alignSelf: 'center',
    width: MARK_SIZE,
    height: MARK_SIZE,
    borderRadius: radius.pill,
    backgroundColor: status.completed.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.titleLarge,
    color: colors.text,
    textAlign: 'center',
  },
  invoiceLine: {
    flexDirection: 'row',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  invoice: {
    ...typography.navItem,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  queue: {
    alignSelf: 'center',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  queueLabel: {
    ...typography.overline,
    color: colors.primaryDark,
    textTransform: 'uppercase',
  },
  queueValue: {
    ...typography.display,
    ...numeric,
    color: colors.primaryDark,
  },
  summary: {
    gap: spacing.sm + spacing.xxs,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  divider: {
    height: sizes.borderWidth,
    backgroundColor: colors.border,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  changeLabel: {
    ...typography.section,
    color: colors.text,
  },
  changeValue: {
    ...typography.hero,
    color: colors.primaryDark,
    flexShrink: 1,
  },
});
