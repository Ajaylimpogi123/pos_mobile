import { CartBar } from '@/components/sell/CartBar';
import { AWAITING_CART_MESSAGE, CartPanel } from '@/components/sell/CartPanel';
import { CustomerPickerDialog } from '@/components/sell/CustomerPickerDialog';
import { OrderDiscountDialog } from '@/components/sell/OrderDiscountDialog';
import { ScPwdSheet } from '@/components/sell/ScPwdSheet';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCart } from '@/hooks/sell/useCart';
import type { CartEditors } from '@/hooks/sell/useCartEditors';
import type { SellLayout } from '@/hooks/useResponsive';

type SellCartAreaProps = {
  layout: SellLayout;
  editors: CartEditors;
};

/**
 * Everything on the Sell screen that shows the cart: the side panel (tablet
 * landscape) or the "View order" bar and its sheet (phones and portrait),
 * and the cart's dialogs (SC/PWD, order discount, customer, clear).
 *
 * Performance: this is the **only** part of the Sell screen that subscribes
 * to the whole cart (`useCart`, which prices it once per change). The menu
 * grid never re-renders when the cart changes; each tile subscribes only to
 * its own in-cart count.
 *
 * It is the second child of the screen's body: a row with the side panel, a
 * column with the bar at the bottom, so the menu keeps its tree position on
 * rotation. The dialogs are modals, so their position doesn't matter.
 */
export function SellCartArea({ layout, editors }: SellCartAreaProps) {
  const cart = useCart();
  const attention = cart.awaitingConfirmation || cart.hasServerMessages || cart.hasProblems;

  return (
    <>
      {layout.cartSide ? <CartPanel variant="side" cart={cart} editors={editors} /> : null}
      {layout.cartBar ? (
        <CartBar
          itemCount={cart.itemCount}
          totalCents={cart.pricing.total_cents}
          tableNo={cart.tableError ? '' : cart.tableNo}
          attention={attention}
          onOpen={editors.openSheet}
        />
      ) : null}
      <BottomSheet
        visible={editors.sheetOpen && layout.cartBar}
        onClose={editors.closeSheet}
        closeLabel="Close cart"
        testID="cart-sheet"
      >
        <CartPanel variant="sheet" cart={cart} editors={editors} />
      </BottomSheet>
      <ScPwdSheet editor={editors.scPwd} lines={cart.lines} applied={cart.scPwd !== null} serverErrors={cart.scPwdErrors} />
      <OrderDiscountDialog
        editors={editors}
        baseCents={cart.pricing.discount_base_cents}
        hasDiscount={cart.orderDiscount !== null}
      />
      {editors.customerPickerOpen ? (
        <CustomerPickerDialog current={cart.customer} onChoose={editors.chooseCustomer} onClose={editors.closeCustomerPicker} />
      ) : null}
      <ConfirmDialog
        visible={editors.clearOpen}
        title="Clear the cart?"
        message={
          cart.awaitingConfirmation
            ? `${AWAITING_CART_MESSAGE} It may have gone through: check Orders before ringing it up again.`
            : 'Every item, discount and the customer are removed from this sale.'
        }
        confirmLabel="Clear cart"
        confirmVariant="danger"
        icon="trash-outline"
        onConfirm={editors.confirmClear}
        onCancel={editors.cancelClear}
        testID="clear-cart-dialog"
      />
    </>
  );
}
