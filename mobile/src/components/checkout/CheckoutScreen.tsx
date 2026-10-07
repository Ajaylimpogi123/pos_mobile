import { useCallback, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalDialog } from '@/components/checkout/ApprovalDialog';
import { CashKeypad } from '@/components/checkout/CashKeypad';
import {
  AmountDueCard,
  CashInput,
  GcashPayments,
  PaymentMethods,
  PaymentResult,
  QuickCash,
} from '@/components/checkout/PaymentsCard';
import { SaleComplete } from '@/components/checkout/SaleComplete';
import { SaleSummaryCard } from '@/components/checkout/SaleSummaryCard';
import { ScPwdSheet } from '@/components/sell/ScPwdSheet';
import { useShell } from '@/components/shell/ShellContext';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES } from '@/constants/routes';
import { layout, spacing } from '@/constants/theme';
import { useCheckout, type CheckoutState } from '@/hooks/sell/useCheckout';
import { useScPwdEditor } from '@/hooks/sell/useScPwdEditor';
import { useResponsive } from '@/hooks/useResponsive';
import { goBackOr } from '@/utils/navigation';

function backToSell() {
  goBackOr(ROUTES.sell);
}

/** Three columns need this much room for each of the two flexible ones. */
const MIN_FLEX_COLUMN = layout.sellTileMinWidth * 2;

/** The messages above Complete sale: offline, no shift, repricing, the last attempt, cart problems. */
function CheckoutAlerts({ checkout }: { checkout: CheckoutState }) {
  const { banner, cart } = checkout;
  const awaiting = cart.awaitingConfirmation;
  const nodes: ReactNode[] = [];
  if (!checkout.online) {
    nodes.push(
      <Banner
        key="offline"
        variant={checkout.offlineBlock ? 'warning' : 'info'}
        message={checkout.offlineBlock ?? checkout.offlineNotice ?? ''}
        testID="checkout-offline"
      />,
    );
  }
  if (checkout.shiftBlock) {
    nodes.push(
      <View key="shift" style={styles.stack}>
        <Banner variant="warning" message={checkout.shiftBlock} testID="checkout-no-shift" />
        <Button title="Back to Sell" leftIcon="arrow-back" variant="secondary" onPress={backToSell} testID="checkout-no-shift-back" />
      </View>,
    );
  }
  if (checkout.repricing) {
    nodes.push(<Banner key="repricing" variant="info" message="Updating the menu and the prices…" testID="checkout-repricing" />);
  }
  if (banner) {
    nodes.push(
      <View key="banner" style={styles.stack}>
        <Banner variant={banner.variant} message={banner.message} testID="checkout-banner" />
        {banner.detail ? <Banner variant="info" message={banner.detail} testID="checkout-banner-detail" /> : null}
        {banner.retry ? (
          <Button
            title="Retry"
            leftIcon="refresh"
            variant="secondary"
            onPress={banner.retry === 'lookup' ? checkout.retryLookup : checkout.confirm}
            disabled={!checkout.canConfirm}
            testID="checkout-retry"
          />
        ) : null}
      </View>,
    );
  }
  if (cart.hasProblems && !awaiting) {
    nodes.push(<Banner key="problems" message="Fix the highlighted items in the cart before charging." testID="checkout-cart-problems" />);
  }
  return nodes.length > 0 ? <View style={styles.stack}>{nodes}</View> : null;
}

/**
 * Checkout (`/(app)/(pos)/sell/checkout`, needs `sale.create`; Checkout board).
 * - Tablet landscape with room: three columns: the order summary; the amount
 *   due, payment methods, quick cash and GCash payments; then the cash
 *   received, the keypad (64 dp keys), the change and **Complete sale**.
 *   Narrower landscape tablets: the summary beside one payment column.
 *   Elsewhere: one centred column. Everything scrolls and inputs stay above
 *   the keyboard; the state lives in `useCheckout`, above the layout switch,
 *   so rotating keeps the typed payments.
 * - Offline (Phase 5): the sale is saved on the tablet and synced later; the
 *   screen says so. Confirm is disabled only when it can't be (a discount that
 *   needs approval, or a tablet that never registered), with the contract's message.
 * - After a timeout the sale is saved on the tablet with the same ULID; when it
 *   can't be, the banner offers Retry (same ULID, same body).
 * - A 201 shows the success screen with the change due, then "New sale".
 */
export function CheckoutScreen() {
  const checkout = useCheckout();
  // Senior Citizen / PWD Discount: the sheet opens from checkout too (its draft lives here, above the layout switch).
  const scPwdEditor = useScPwdEditor();
  const { isTwoPane, formMaxWidth, contentMaxWidth, screenPaddingX, screenPaddingY, gutter, width, isCompactHeight } =
    useResponsive();
  const { sidebarWidth } = useShell();
  const cashRef = useRef<TextInput>(null);
  const focusCash = useCallback(() => cashRef.current?.focus(), []);
  const { cart, completed } = checkout;

  const items = `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}`;
  const table = cart.tableError ? '' : cart.tableNo.trim();
  const header = (
    <TopBar
      title={completed ? 'Sale complete' : 'Checkout'}
      subtitle={completed || cart.isEmpty ? null : `${items}${table ? ` · Table ${table}` : ''}`}
      left={
        <IconButton
          icon="arrow-back"
          variant="bar"
          accessibilityLabel="Back"
          onPress={backToSell}
          disabled={checkout.submitting}
          testID="checkout-back"
        />
      }
      testID="checkout-header"
    />
  );

  if (completed) {
    return (
      <Screen edges={[]} testID="checkout-screen">
        {header}
        <SaleComplete order={completed} note={checkout.completedNote} onNewSale={backToSell} />
      </Screen>
    );
  }

  if (cart.isEmpty) {
    return (
      <Screen edges={[]} testID="checkout-screen">
        {header}
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
          <EmptyState
            title="Nothing to charge"
            message="Add items to the cart on the Sell screen first."
            icon="cart-outline"
            actionLabel="Back to Sell"
            onAction={backToSell}
            testID="checkout-empty"
          />
        </SafeAreaView>
      </Screen>
    );
  }

  const awaiting = cart.awaitingConfirmation;
  const available = width - sidebarWidth - 2 * screenPaddingX;
  const threeColumns = isTwoPane && available >= layout.pinPadMaxWidth + 2 * gutter + 2 * MIN_FLEX_COLUMN;
  const showKeypad = !isCompactHeight;

  const summary = (
    <SaleSummaryCard
      lines={cart.lines}
      orderDiscount={cart.orderDiscount}
      customer={cart.customer}
      pricing={cart.pricing}
      scPwd={cart.scPwd}
      onEditScPwd={scPwdEditor.open}
      scPwdDisabled={checkout.locked}
      scPwdError={cart.scPwdError}
    />
  );
  const due = <AmountDueCard totalCents={cart.pricing.total_cents} />;
  const methods = <PaymentMethods checkout={checkout} onCash={focusCash} />;
  const cashInput = <CashInput checkout={checkout} inputRef={cashRef} />;
  const quick = <QuickCash checkout={checkout} />;
  const keypad = showKeypad ? (
    <CashKeypad value={checkout.draft.cash} onChange={checkout.setCash} disabled={checkout.locked} testID="checkout-keypad" />
  ) : null;
  const gcash = <GcashPayments checkout={checkout} />;
  const result = <PaymentResult checkout={checkout} />;
  const alerts = <CheckoutAlerts checkout={checkout} />;
  const cta = (
    <Button
      title={awaiting ? 'Retry sale' : 'Complete sale'}
      leftIcon={awaiting ? 'refresh' : 'checkmark'}
      size="xl"
      onPress={checkout.confirm}
      loading={checkout.submitting}
      disabled={!checkout.canConfirm}
      testID="checkout-confirm"
    />
  );

  let body: ReactNode;
  if (threeColumns) {
    body = (
      <View style={[styles.inner, styles.row, { gap: gutter, maxWidth: contentMaxWidth }]} testID="checkout-two-pane">
        <View style={styles.flexColumn}>{summary}</View>
        <View style={[styles.flexColumn, { gap: gutter }]}>
          {due}
          {methods}
          {quick}
          {gcash}
        </View>
        <View style={[styles.tenderColumn, { gap: spacing.lg }]}>
          {cashInput}
          {keypad}
          {result}
          {alerts}
          {cta}
        </View>
      </View>
    );
  } else if (isTwoPane) {
    body = (
      <View style={[styles.inner, styles.row, { gap: gutter, maxWidth: layout.formWideMaxWidth }]} testID="checkout-two-pane">
        <View style={styles.summaryPane}>{summary}</View>
        <View style={[styles.paymentPane, { gap: gutter }]}>
          {due}
          {methods}
          {cashInput}
          {quick}
          {keypad}
          {gcash}
          {result}
          {alerts}
          {cta}
        </View>
      </View>
    );
  } else {
    body = (
      <View style={[styles.inner, { gap: gutter, maxWidth: formMaxWidth }]} testID="checkout-one-column">
        {due}
        {summary}
        {methods}
        {cashInput}
        {quick}
        {keypad}
        {gcash}
        {result}
        {alerts}
        {cta}
      </View>
    );
  }

  return (
    <Screen edges={[]} testID="checkout-screen">
      {header}
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        <KeyboardScrollView
          contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }}
          testID="checkout-scroll"
        >
          {body}
        </KeyboardScrollView>
      </SafeAreaView>
      <ApprovalDialog checkout={checkout} />
      <ScPwdSheet editor={scPwdEditor} lines={cart.lines} applied={cart.scPwd !== null} serverErrors={cart.scPwdErrors} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
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
  flexColumn: {
    flex: 1,
    minWidth: 0,
  },
  tenderColumn: {
    width: layout.pinPadMaxWidth,
  },
  summaryPane: {
    flex: layout.asidePaneFlex,
  },
  paymentPane: {
    flex: layout.mainPaneFlex,
  },
  stack: {
    gap: spacing.sm,
  },
});
