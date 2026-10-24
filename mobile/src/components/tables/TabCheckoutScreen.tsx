import { router } from 'expo-router';
import { useCallback, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalDialog } from '@/components/checkout/ApprovalDialog';
import { CashKeypad } from '@/components/checkout/CashKeypad';
import { AmountDueCard, CashInput, GcashPayments, PaymentMethods, PaymentResult, QuickCash, SectionLabel } from '@/components/checkout/PaymentsCard';
import { SaleComplete } from '@/components/checkout/SaleComplete';
import { SaleSummaryCard } from '@/components/checkout/SaleSummaryCard';
import { OrderDiscountDialog } from '@/components/sell/OrderDiscountDialog';
import { ScPwdSheet } from '@/components/sell/ScPwdSheet';
import { guestsLabel, tableLabel, TABLES_OFFLINE_MESSAGE } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconBadge } from '@/components/ui/IconBadge';
import { IconButton } from '@/components/ui/IconButton';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { LoadingState } from '@/components/ui/LoadingState';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { Screen } from '@/components/ui/Screen';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES, tabRoute } from '@/constants/routes';
import { colors, layout, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import { useCartEditors } from '@/hooks/sell/useCartEditors';
import { useTabCheckout, type TabCheckoutState } from '@/hooks/tables/useTabCheckout';
import { useSellModeStore } from '@/hooks/tables/useTablesView';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { Tab } from '@/services/types';
import { CartStoreProvider } from '@/stores/cart';
import { tabSettlementCart, type TabPayMode } from '@/stores/tabCarts';
import { formatPeso } from '@pos/core/money';
import { serviceChargeLabel } from '@pos/core/printing/documents/receipt';
import { SPLIT_COUNT_MAX, SPLIT_COUNT_MIN } from '@pos/core/sale/serviceCharge';
import { tabRemainingLines } from '@pos/core/sale/tab';
import { goBackOr } from '@/utils/navigation';

const MODES: readonly SegmentOption<TabPayMode>[] = [
  { value: 'whole', label: 'Whole bill', testID: 'tab-pay-mode-whole' },
  { value: 'items', label: 'By item', testID: 'tab-pay-mode-items' },
  { value: 'equal', label: 'Equally', testID: 'tab-pay-mode-equal' },
];

function backToTab(ulid: string) {
  goBackOr(tabRoute(ulid));
}

/** What is paid now: the mode, the items (By item), the shares (Equally) and the service charge. */
function WhatToPay({ pay, tab }: { pay: TabCheckoutState; tab: Tab }) {
  const remaining = tabRemainingLines(tab);
  return (
    <View style={styles.card} testID="tab-pay-what">
      <SectionLabel>What to pay</SectionLabel>
      <SegmentedControl<TabPayMode>
        options={MODES}
        value={pay.mode}
        onChange={pay.setMode}
        disabled={pay.controls.locked}
        accessibilityLabel="How to pay"
        testID="tab-pay-mode"
      />
      {pay.mode === 'items' ? (
        <View style={styles.items}>
          {remaining.map((item) => (
            <View key={item.id} style={styles.itemRow} testID={`tab-pay-item-${item.id}`}>
              <View style={styles.itemText}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.product_name}
                </Text>
                <Text style={styles.itemMeta}>
                  {formatPeso(item.unit_price_cents)} · {item.remaining_qty} left
                </Text>
              </View>
              <QtyStepper
                value={pay.selected[item.id] ?? 0}
                onChange={(qty) => pay.setSelected(item.id, qty)}
                min={0}
                max={item.remaining_qty}
                accessibilityLabel={`${item.product_name} to pay now`}
                disabled={pay.controls.locked}
                testID={`tab-pay-item-${item.id}-qty`}
              />
            </View>
          ))}
        </View>
      ) : null}
      {pay.mode === 'equal' ? (
        <View style={styles.inline}>
          <Text style={styles.label}>Split between</Text>
          <QtyStepper
            value={pay.shareCount}
            onChange={pay.setShareCount}
            min={SPLIT_COUNT_MIN}
            max={SPLIT_COUNT_MAX}
            accessibilityLabel="Number of shares"
            disabled={pay.controls.locked}
            testID="tab-pay-shares"
          />
        </View>
      ) : null}
      {pay.serviceChargeBps > 0 ? (
        <SwitchRow
          label={`${serviceChargeLabel(pay.serviceChargeBps)} · ${formatPeso(pay.serviceChargeIfOn)}`}
          description="Off: no service charge on this payment."
          value={pay.serviceCharge}
          onValueChange={pay.setServiceCharge}
          disabled={pay.controls.locked}
          testID="tab-pay-service-charge"
        />
      ) : null}
    </View>
  );
}

/** Equally: the shares, which one is being paid, and Back / Next. */
function ShareSteps({ pay }: { pay: TabCheckoutState }) {
  if (!pay.split) return null;
  return (
    <View style={styles.card} testID="tab-pay-share-steps">
      <Text style={styles.shareTitle} accessibilityRole="header" testID="tab-pay-share-title">
        Share {pay.shareIndex + 1} of {pay.shareCount} · {formatPeso(pay.dueCents)}
      </Text>
      <View style={styles.shareList}>
        {pay.shares.map((cents, index) => {
          const ready = pay.shareReady(index);
          return (
            <Text key={index} style={[styles.shareItem, index === pay.shareIndex && styles.shareCurrent]} testID={`tab-pay-share-${index}`}>
              {index + 1}. {formatPeso(cents)}
              {ready ? ' · ready' : ''}
            </Text>
          );
        })}
      </View>
      <View style={styles.inline}>
        <Button
          title="Previous share"
          leftIcon="arrow-back"
          variant="secondary"
          onPress={() => pay.goToShare(pay.shareIndex - 1)}
          disabled={pay.shareIndex === 0 || pay.submitting}
          style={styles.flex}
          testID="tab-pay-share-prev"
        />
        <Button
          title="Next share"
          rightIcon="arrow-forward"
          variant="secondary"
          onPress={() => pay.goToShare(pay.shareIndex + 1)}
          disabled={pay.lastShare || pay.submitting}
          style={styles.flex}
          testID="tab-pay-share-next"
        />
      </View>
    </View>
  );
}

function Alerts({ pay }: { pay: TabCheckoutState }) {
  const nodes: ReactNode[] = [];
  if (pay.shiftBlock) nodes.push(<Banner key="shift" variant="warning" message={pay.shiftBlock} testID="tab-pay-no-shift" />);
  if (pay.banner) {
    nodes.push(
      <View key="banner" style={styles.stack}>
        <Banner variant={pay.banner.variant} message={pay.banner.message} testID="tab-pay-banner" />
        {pay.banner.retry ? (
          <Button
            title="Retry"
            leftIcon="refresh"
            variant="secondary"
            onPress={pay.banner.retry === 'lookup' ? pay.retryLookup : pay.confirm}
            disabled={pay.submitting}
            testID="tab-pay-retry"
          />
        ) : null}
      </View>,
    );
  }
  if (!pay.pricing.valid && !pay.cart.isEmpty) {
    nodes.push(<Banner key="problems" message="Fix the discounts before charging." testID="tab-pay-problems" />);
  }
  return nodes.length > 0 ? <View style={styles.stack}>{nodes}</View> : null;
}

/** The settlement screen, under the settlement cart's provider. */
function TabCheckoutBody({ ulid }: { ulid: string }) {
  const pay = useTabCheckout(ulid);
  const editors = useCartEditors();
  const { isTwoPane, formMaxWidth, screenPaddingX, screenPaddingY, gutter, isCompactHeight } = useResponsive();
  const cashRef = useRef<TextInput>(null);
  const focusCash = useCallback(() => cashRef.current?.focus(), []);
  const { tab, cart, completed } = pay;

  const title = tab ? `Pay · ${tableLabel(tab.table.name)}` : 'Pay';
  const header = (
    <TopBar
      title={completed ? 'Payment complete' : title}
      subtitle={tab && !completed ? guestsLabel(tab.guests) : null}
      left={
        <IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back to the bill" onPress={() => backToTab(ulid)} disabled={pay.submitting} testID="tab-pay-back" />
      }
      testID="tab-pay-header"
    />
  );

  if (completed) {
    const closed = completed.tab.status !== 'open';
    return (
      <Screen edges={[]} testID="tab-pay-screen">
        {header}
        <SaleComplete
          order={completed.order}
          note={completed.note ?? (closed ? `${tableLabel(completed.tab.table.name)} is paid and free again.` : 'Part of the bill is still open.')}
          onNewSale={() => {
            if (closed) {
              useSellModeStore.getState().setMode('tables');
              router.replace(ROUTES.sell);
            } else {
              backToTab(ulid);
            }
          }}
        />
      </Screen>
    );
  }

  let content: ReactNode;
  if (!pay.online) {
    content = <EmptyState title={TABLES_OFFLINE_MESSAGE} message="Bills are paid online. Pay now still works offline." icon="cloud-offline-outline" testID="tab-pay-offline" />;
  } else if (pay.tabLoading) {
    content = <LoadingState message="Opening the bill…" testID="tab-pay-loading" />;
  } else if (!tab) {
    content = <ErrorState title="Couldn't open the bill" message={getErrorMessage(pay.tabError)} onRetry={pay.refetchTab} testID="tab-pay-error" />;
  } else if (tab.status !== 'open' || tabRemainingLines(tab).length === 0) {
    content = (
      <EmptyState
        title="Nothing left to pay"
        message="Every item on this bill is paid or cancelled."
        icon="checkmark-done-outline"
        actionLabel="Back to the bill"
        onAction={() => backToTab(ulid)}
        testID="tab-pay-nothing"
      />
    );
  } else {
    const what = <WhatToPay pay={pay} tab={tab} />;
    const summary = cart.isEmpty ? (
      <Banner variant="info" message="Choose the items to pay now." testID="tab-pay-none-selected" />
    ) : (
      <View style={styles.stack}>
        <SaleSummaryCard
          lines={cart.lines}
          orderDiscount={cart.orderDiscount}
          customer={cart.customer}
          pricing={pay.pricing}
          scPwd={cart.scPwd}
          onEditScPwd={editors.scPwd.open}
          scPwdDisabled={pay.controls.locked}
          scPwdError={cart.scPwdError}
          serviceCharge={{ label: serviceChargeLabel(pay.serviceChargeBps), cents: pay.serviceChargeCents }}
        />
        <Button
          title={cart.orderDiscount ? 'Edit discount' : 'Add discount'}
          leftIcon="pricetags-outline"
          variant={cart.orderDiscount ? 'tonal' : 'secondary'}
          onPress={editors.editOrderDiscount}
          disabled={pay.controls.locked || cart.scPwd !== null}
          testID="tab-pay-discount"
        />
        {cart.orderDiscountError ? <Text style={styles.error}>{cart.orderDiscountError}</Text> : null}
      </View>
    );
    const payments = (
      <View style={[styles.stack, { gap: gutter }]}>
        <ShareSteps pay={pay} />
        <AmountDueCard totalCents={pay.dueCents} />
        <PaymentMethods checkout={pay.controls} onCash={focusCash} />
        <CashInput checkout={pay.controls} inputRef={cashRef} />
        <QuickCash checkout={pay.controls} />
        {isCompactHeight ? null : (
          <CashKeypad value={pay.controls.draft.cash} onChange={pay.controls.setCash} disabled={pay.controls.locked} testID="tab-pay-keypad" />
        )}
        <GcashPayments checkout={pay.controls} />
        <PaymentResult checkout={pay.controls} />
        <Alerts pay={pay} />
        {pay.lastShare ? (
          <Button
            title={cart.awaitingConfirmation ? 'Retry payment' : `Complete payment · ${formatPeso(pay.pricing.total_cents)}`}
            leftIcon={cart.awaitingConfirmation ? 'refresh' : 'checkmark'}
            size="xl"
            onPress={pay.confirm}
            loading={pay.submitting}
            disabled={!pay.canConfirm}
            testID="tab-pay-confirm"
          />
        ) : (
          <Button
            title="Next share"
            rightIcon="arrow-forward"
            size="xl"
            onPress={() => pay.goToShare(pay.shareIndex + 1)}
            testID="tab-pay-next"
          />
        )}
      </View>
    );
    content = (
      <KeyboardScrollView contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }} testID="tab-pay-scroll">
        {isTwoPane ? (
          <View style={[styles.inner, styles.row, { gap: gutter, maxWidth: layout.formWideMaxWidth }]} testID="tab-pay-two-pane">
            <View style={[styles.aside, { gap: gutter }]}>
              {what}
              {summary}
            </View>
            <View style={styles.main}>{payments}</View>
          </View>
        ) : (
          <View style={[styles.inner, { gap: gutter, maxWidth: formMaxWidth }]} testID="tab-pay-one-column">
            {what}
            {summary}
            {payments}
          </View>
        )}
      </KeyboardScrollView>
    );
  }

  return (
    <Screen edges={[]} testID="tab-pay-screen">
      {header}
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        {content}
      </SafeAreaView>
      <ApprovalDialog checkout={pay} />
      <ScPwdSheet editor={editors.scPwd} lines={cart.lines} applied={cart.scPwd !== null} serverErrors={cart.scPwdErrors} />
      <OrderDiscountDialog editors={editors} baseCents={pay.pricing.discount_base_cents} hasDiscount={cart.orderDiscount !== null} />
      <DialogFrame visible={pay.conflict !== null} onRequestClose={pay.dismissConflict} testID="tab-pay-conflict">
        <IconBadge icon="alert-circle-outline" tone="info" />
        <Text style={styles.title} accessibilityRole="header">
          This bill changed
        </Text>
        <Text style={styles.message} testID="tab-pay-conflict-message">
          {pay.conflict ?? ''}
        </Text>
        <Button title="Review the bill" leftIcon="refresh" onPress={pay.dismissConflict} testID="tab-pay-conflict-ok" />
      </DialogFrame>
    </Screen>
  );
}

/**
 * **Pay** a tab (`/tabs/[ulid]/pay`, `sale.create`; Dine-in Tables & Tabs
 * §I): the whole bill, by item, or equally with one payment step per share,
 * with discounts, SC/PWD and the service-charge toggle. The settlement is
 * its own cart, handed to the checkout's parts through `CartStoreProvider`.
 * Tablet landscape: what to pay and the summary beside the payments; one
 * centred column elsewhere. Everything scrolls and stays above the keyboard.
 */
export function TabCheckoutScreen({ ulid }: { ulid: string }) {
  return (
    <CartStoreProvider value={tabSettlementCart}>
      <TabCheckoutBody ulid={ulid} />
    </CartStoreProvider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  aside: {
    flex: layout.asidePaneFlex,
    minWidth: 0,
  },
  main: {
    flex: layout.mainPaneFlex,
    minWidth: 0,
  },
  stack: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  items: {
    gap: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  itemMeta: {
    ...typography.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  shareTitle: {
    ...typography.heading,
    ...numeric,
    color: colors.text,
  },
  shareList: {
    gap: spacing.xxs,
  },
  shareItem: {
    ...typography.bodySm,
    ...numeric,
    color: colors.textSecondary,
  },
  shareCurrent: {
    ...typography.bodyStrong,
    color: colors.primaryDark,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
