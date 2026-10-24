import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrintJobRows } from '@/components/printing/PrintJobRows';
import { CartLineRow } from '@/components/sell/CartLineRow';
import { checkoutLabel } from '@/components/sell/CartPanel';
import { AmountRow } from '@/components/shared/AmountRow';
import { guestsLabel, roundLabel, tableLabel } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { colors, hitTarget, iconSizes, layout, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { tabPayRoute } from '@/constants/routes';
import { useCart } from '@/hooks/sell/useCart';
import type { CartEditors } from '@/hooks/sell/useCartEditors';
import { usePrintJobs } from '@/hooks/printing/usePrintJobs';
import { useServiceChargeBps } from '@/hooks/tables/useDineIn';
import type { TabState } from '@/hooks/tables/useTab';
import type { TabItemCancelState } from '@/hooks/tables/useTabItemCancel';
import type { TabMoveState } from '@/hooks/tables/useTabMove';
import { useResponsive } from '@/hooks/useResponsive';
import type { Tab, TabItem } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatPercentValue } from '@pos/core/sale/discountRules';
import { tabRemainingLines } from '@pos/core/sale/tab';

type TabPanelProps = {
  variant: 'side' | 'sheet';
  state: TabState;
  tab: Tab;
  editors: CartEditors;
  cancel: TabItemCancelState;
  move: TabMoveState;
};

const NO_JOBS: readonly string[] = [];

function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/** "1 paid · 1 cancelled" (nothing when the whole line is still to pay). */
function lineState(item: TabItem): string | null {
  const parts: string[] = [];
  if (item.settled_qty > 0) parts.push(`${item.settled_qty} paid`);
  if (item.cancelled_qty > 0) parts.push(`${item.cancelled_qty} cancelled`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

type BillLineProps = { item: TabItem; onCancel: (item: TabItem) => void; disabled: boolean };

function BillLine({ item, onCancel, disabled }: BillLineProps) {
  const state = lineState(item);
  const done = item.remaining_qty === 0;
  return (
    <View style={styles.billLine} testID={`tab-item-${item.id}`}>
      <View style={styles.billText}>
        <Text style={[styles.billName, done && styles.billDone]} numberOfLines={2}>
          {item.remaining_qty > 0 ? `${item.remaining_qty} × ` : ''}
          {item.product_name}
        </Text>
        {item.notes ? (
          <Text style={styles.billNote} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
        {state ? <Text style={styles.billNote}>{state}</Text> : null}
      </View>
      <Text style={[styles.billAmount, done && styles.billDone]} numberOfLines={1}>
        {formatPeso(item.unit_price_cents * item.remaining_qty)}
      </Text>
      {item.remaining_qty > 0 ? (
        <Button
          title="Cancel"
          variant="ghost"
          onPress={() => onCancel(item)}
          disabled={disabled}
          accessibilityLabel={`Cancel ${item.product_name}`}
          testID={`tab-item-${item.id}-cancel`}
        />
      ) : null}
    </View>
  );
}

/**
 * The tab's order panel (Dine-in Tables & Tabs §I): the side column on a
 * tablet in landscape (always visible), the sheet elsewhere.
 * - **New round**: the cart's lines (stepper, editor, remove) and **Send to
 *   kitchen**, which sends the round, prints its ticket and clears it.
 * - **Bill**: the sent items by round, each with **Cancel**; the orders
 *   already paid; the amount still to pay (before discounts).
 * - Actions: **Pay**, **Print bill**, **Transfer**, **Merge**, and **Close
 *   bill** once nothing is left to pay.
 */
export function TabPanel({ variant, state, tab, editors, cancel, move }: TabPanelProps) {
  const { isCompactHeight } = useResponsive();
  const cart = useCart();
  const serviceChargeBps = useServiceChargeBps();
  const side = variant === 'side';
  const locked = cart.awaitingConfirmation;
  const remaining = tabRemainingLines(tab);
  const rounds = [...new Set(tab.items.map((item) => item.round_no))];
  const printJobs = usePrintJobs(state.print?.jobIds ?? NO_JOBS);
  const cancelJobs = usePrintJobs(cancel.print?.jobIds ?? NO_JOBS);
  const busy = state.busy !== null || state.sending;
  const nothingLeft = remaining.length === 0;
  const roundHasItems = !cart.isEmpty;

  const sendButton = (
    <Button
      title={locked ? 'Retry sending' : `Send to kitchen${cart.isEmpty ? '' : ` (${cart.itemCount})`}`}
      leftIcon={locked ? 'refresh' : 'restaurant-outline'}
      size="xl"
      onPress={state.send}
      loading={state.sending}
      disabled={cart.isEmpty || state.sending || (!locked && cart.hasProblems)}
      testID="tab-send"
    />
  );

  return (
    <SafeAreaView
      edges={side ? ['top', 'right', 'bottom'] : []}
      style={[styles.panel, side ? styles.side : styles.sheet]}
      testID={`tab-panel-${variant}`}
    >
      <View style={[styles.header, side ? styles.padSide : styles.padSheet]}>
        <View style={styles.titleText}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {tableLabel(tab.table.name)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${guestsLabel(tab.guests)}. Change`}
            onPress={state.editGuests}
            hitSlop={spacing.sm}
            style={({ pressed }) => [styles.guests, pressed && styles.pressed]}
            testID="tab-guests"
          >
            <Icon name="people-outline" size={iconSizes.sm} color={colors.primary} />
            <Text style={styles.guestsText}>{guestsLabel(tab.guests)}</Text>
          </Pressable>
        </View>
        {side ? null : (
          <IconButton icon="close" variant="ghost" accessibilityLabel="Close the bill panel" onPress={editors.closeSheet} testID="tab-panel-close" />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, side ? styles.padSide : styles.padSheet]}
        keyboardShouldPersistTaps="handled"
        testID="tab-scroll"
      >
        {state.banner ? (
          <View style={styles.stack}>
            <Banner variant={state.banner.variant} message={state.banner.message} testID="tab-banner" />
            {state.banner.retry ? (
              <Button title="Retry" leftIcon="refresh" variant="secondary" onPress={state.send} disabled={state.sending} testID="tab-retry" />
            ) : null}
          </View>
        ) : null}
        {state.print?.notice ? <Banner variant="warning" message={state.print.notice} testID="tab-print-notice" /> : null}
        {state.print && state.print.unrouted.length > 0 ? (
          <Banner variant="warning" message={`No kitchen or bar printer was told about: ${state.print.unrouted.join(', ')}`} testID="tab-unrouted" />
        ) : null}
        <PrintJobRows jobs={printJobs} testID="tab-job" />
        {cancel.print?.notice ? <Banner variant="warning" message={cancel.print.notice} testID="tab-void-notice" /> : null}
        <PrintJobRows jobs={cancelJobs} testID="tab-void-job" />

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            New round
          </Text>
          <Text style={styles.sectionMeta}>{itemsLabel(cart.itemCount)}</Text>
          <IconButton
            icon="trash-outline"
            variant="ghost"
            accessibilityLabel="Clear the new round"
            onPress={editors.requestClear}
            disabled={cart.isEmpty}
            testID="tab-round-clear"
          />
        </View>
        {cart.cartError ? <Banner message={cart.cartError} testID="tab-round-error" /> : null}
        {cart.isEmpty ? (
          <Text style={styles.hint} testID="tab-round-empty">
            Tap items on the menu to add them, then send them to the kitchen.
          </Text>
        ) : (
          <View>
            {cart.lines.map((line, index) => (
              <CartLineRow
                key={line.key}
                line={line}
                priced={cart.pricing.lines[index]}
                index={index}
                error={cart.lineErrors[line.key]}
                locked={locked}
                onEdit={editors.editLine}
                onQtyChange={(key, qty) => state.round.getState().setQty(key, qty)}
                onRemove={(key) => state.round.getState().removeLine(key)}
              />
            ))}
          </View>
        )}
        {isCompactHeight || !side ? sendButton : null}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Bill
          </Text>
          <Text style={styles.sectionMeta}>{tab.rounds_count === 1 ? '1 round' : `${tab.rounds_count} rounds`}</Text>
        </View>
        {tab.items.length === 0 ? (
          <Text style={styles.hint} testID="tab-bill-empty">
            Nothing sent to the kitchen yet.
          </Text>
        ) : (
          rounds.map((roundNo) => (
            <View key={roundNo} style={styles.round} testID={`tab-round-${roundNo}`}>
              <Text style={styles.roundTitle}>{roundLabel(roundNo)}</Text>
              {tab.items
                .filter((item) => item.round_no === roundNo)
                .map((item) => (
                  <BillLine key={item.id} item={item} onCancel={cancel.request} disabled={busy} />
                ))}
            </View>
          ))
        )}
        {tab.orders.length > 0 ? (
          <View style={styles.round} testID="tab-orders">
            <Text style={styles.roundTitle}>Paid</Text>
            {tab.orders.map((order) => (
              <AmountRow key={order.ulid} label={order.invoice_no} cents={order.total_cents} variant="muted" />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, side ? styles.padSide : styles.padSheet]}>
        <AmountRow label="To pay" cents={tab.remaining_cents} variant="total" testID="tab-remaining" />
        {serviceChargeBps > 0 && !nothingLeft ? (
          <Text style={styles.hint}>Before discounts. A {formatPercentValue(serviceChargeBps)} service charge is added at payment.</Text>
        ) : null}
        {side && !isCompactHeight ? sendButton : null}
        {nothingLeft ? null : (
          <Button
            title={checkoutLabel(tab.remaining_cents)}
            size="xl"
            onPress={() => router.push(tabPayRoute(tab.ulid))}
            disabled={busy || locked}
            testID="tab-pay"
          />
        )}
        <View style={styles.actions}>
          {nothingLeft ? (
            <Button
              title="Close bill"
              leftIcon="checkmark-done"
              onPress={state.requestClose}
              disabled={busy || roundHasItems}
              style={styles.action}
              testID="tab-close"
            />
          ) : null}
          <Button
            title="Print bill"
            leftIcon="print-outline"
            variant="secondary"
            onPress={state.printBill}
            loading={state.busy === 'bill'}
            disabled={busy || nothingLeft}
            style={styles.action}
            testID="tab-print-bill"
          />
        </View>
        <View style={styles.actions}>
          <Button
            title="Transfer"
            leftIcon="swap-horizontal"
            variant="secondary"
            onPress={() => move.open('transfer')}
            disabled={busy}
            style={styles.action}
            testID="tab-transfer"
          />
          <Button
            title="Merge"
            leftIcon="git-merge-outline"
            variant="secondary"
            onPress={() => move.open('merge')}
            disabled={busy || roundHasItems}
            accessibilityHint={roundHasItems ? 'Send or clear the new round first' : undefined}
            style={styles.action}
            testID="tab-merge"
          />
        </View>
        {roundHasItems && nothingLeft ? <Text style={styles.hint}>Send or clear the new round before closing.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
  },
  side: {
    width: layout.cartPanelWidth,
    borderLeftWidth: sizes.borderWidth,
    borderLeftColor: colors.border,
  },
  sheet: {
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.border,
  },
  padSide: {
    paddingHorizontal: spacing.xl,
  },
  padSheet: {
    paddingHorizontal: spacing.lg,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  guests: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: hitTarget.min / 2,
  },
  guestsText: {
    ...typography.label,
    color: colors.primary,
  },
  pressed: {
    opacity: opacity.pressed,
    transform: [{ scale: pressedScale }],
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  stack: {
    gap: spacing.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.bodySm,
    color: colors.textSecondary,
    flex: 1,
  },
  hint: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  round: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  roundTitle: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  billLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: hitTarget.min,
  },
  billText: {
    flex: 1,
    minWidth: 0,
  },
  billName: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  billNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  billDone: {
    color: colors.textMuted,
  },
  billAmount: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.primary,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    borderTopLeftRadius: radius.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
