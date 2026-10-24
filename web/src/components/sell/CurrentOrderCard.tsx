/**
 * The Current Order card (MASTER §3; legacy `CartSummary.jsx`): always
 * visible on web. Header with the item count; Table and Customer buttons; the
 * lines (newest first); the summary box with Subtotal, the red Discount row
 * (SC/PWD and Amount), the SC/PWD rows and the bordered Total; then the
 * **Checkout (₱total)** pill (`F2`). The total is the client checksum; the
 * server recomputes it, and after checkout its confirmed total is shown.
 *
 * Dine-in (v1.26 §I) reuses it: `round` is the round being built on a tab
 * (no discounts, **Send to kitchen**); `settle` is the tab's lines at **Pay**
 * (quantities up to what remains, the service charge row, **Pay**).
 */
import { ChefHatIcon, IdCardIcon, LoaderCircleIcon, TrashIcon, UserIcon, UtensilsIcon, XIcon } from 'lucide-react';

import { Banner } from '@/components/common/Banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/misc';
import { SHOW_VAT_BREAKDOWN } from '@pos/core/features';
import type { CartEditors } from '@/hooks/sell/useCartEditors';
import type { CartView } from '@/hooks/sell/useCart';
import { cn } from '@/lib/utils';
import { describeDiscount } from '@pos/core/sale/discountRules';
import { describeScPwd, SC_PWD_DISCOUNT_LABEL } from '@pos/core/sale/scPwd';
import { useActiveCartStore, type CartLine } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';
import { serviceChargeLabel } from '@pos/core/printing/documents/receipt';
import { equalSplitShares } from '@pos/core/sale/serviceCharge';

import type { CartVariant } from './CartDialogs';

import { ProductImage, QtyStepper } from './SellParts';

type CurrentOrderCardProps = {
  cart: CartView;
  editors: CartEditors;
  onCheckout: () => void;
  needsApproval: boolean;
  variant?: CartVariant;
  /** The main button's request is running (a round being sent). */
  busy?: boolean;
  /** The main button is disabled for another reason (e.g. offline). */
  disabled?: boolean;
};

const TITLES: Record<CartVariant, string> = { sale: 'Current Order', round: 'New round', settle: 'Pay bill' };

const EMPTY_TEXT: Record<CartVariant, string> = {
  sale: 'The cart is empty. Add products from the menu.',
  round: 'Add items from the menu, then send them to the kitchen.',
  settle: 'Nothing is selected to pay.',
};

const LOCKED_TEXT: Record<CartVariant, string> = {
  sale: "The last sale attempt isn't confirmed yet. Open checkout and Retry it before changing the cart.",
  round: "The last send isn't confirmed yet. Send it again before changing the round.",
  settle: "The last payment attempt isn't confirmed yet. Open Pay and Retry it before changing the bill.",
};

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span>{label}</span>
      <span className="font-semibold tabular">{value}</span>
    </div>
  );
}

export function CurrentOrderCard({ cart, editors, onCheckout, needsApproval, variant = 'sale', busy = false, disabled = false }: CurrentOrderCardProps) {
  const { pricing } = cart;
  const lines = [...cart.lines].reverse();
  const locked = cart.awaitingConfirmation;
  const regularDiscount = pricing.line_discounts_cents + pricing.order_discount_cents;

  return (
    <Card className="flex flex-col gap-4 p-4 @min-[1004px]:sticky @min-[1004px]:top-14" aria-label="Current order">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h2 className="text-xl font-bold">{TITLES[variant]}</h2>
        <Badge tone="neutral" className="px-3">
          {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
        </Badge>
      </div>

      {variant === 'round' ? null : (
        <div className="grid grid-cols-2 gap-2">
          {variant === 'settle' ? (
            <span className="flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium">
              <UtensilsIcon className="size-4" aria-hidden="true" />
              <span className="truncate">Table {cart.tableNo}</span>
            </span>
          ) : (
            <Button variant="outline" className="h-11 justify-start" onClick={editors.editTable} disabled={locked}>
              <UtensilsIcon aria-hidden="true" />
              <span className="truncate">{cart.tableNo.trim() ? `Table ${cart.tableNo.trim()}` : 'Table'}</span>
            </Button>
          )}
          <Button variant="outline" className="h-11 justify-start" onClick={editors.openCustomerPicker} disabled={locked}>
            <UserIcon aria-hidden="true" />
            <span className="truncate">{cart.customer ? cart.customer.full_name : 'Customer'}</span>
          </Button>
        </div>
      )}
      {cart.tableError ? <p className="-mt-2 text-[13px] font-medium text-danger">{cart.tableError}</p> : null}
      {cart.customerError ? <p className="-mt-2 text-[13px] font-medium text-danger">{cart.customerError}</p> : null}

      {locked ? (
        <Banner variant="warning">{LOCKED_TEXT[variant]}</Banner>
      ) : null}
      {editors.notice ? (
        <Banner
          variant="warning"
          actions={
            <Button variant="ghost" size="sm" onClick={editors.dismissNotice}>
              Dismiss
            </Button>
          }
        >
          {editors.notice}
        </Banner>
      ) : null}

      <div className="flex max-h-[min(420px,45dvh)] flex-col gap-2 overflow-y-auto pr-1">
        {lines.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">{EMPTY_TEXT[variant]}</p>
        ) : (
          lines.map((line) => (
            <CartLineBox key={line.key} line={line} cart={cart} editors={editors} locked={locked} variant={variant} />
          ))
        )}
      </div>

      {cart.lines.length > 0 && variant === 'round' ? (
        <div className="flex items-center justify-between rounded-xl bg-subtle p-4 text-[15px]">
          <span className="font-semibold">Round subtotal</span>
          <span className="text-lg font-bold text-green tabular">{formatPeso(pricing.subtotal_cents)}</span>
        </div>
      ) : null}

      {cart.lines.length > 0 && variant !== 'round' ? (
        <div className="flex flex-col gap-2 rounded-xl bg-subtle p-4 text-[15px]">
          <Row label="Subtotal" value={formatPeso(pricing.subtotal_cents)} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-danger">
            <span className="flex items-center gap-1.5">
              Discount
              <Button variant="outline" size="sm" className="h-8 text-foreground" onClick={editors.scPwd.open} disabled={locked}>
                <IdCardIcon aria-hidden="true" />
                SC/PWD
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-foreground"
                onClick={editors.editOrderDiscount}
                disabled={locked || cart.scPwd !== null}
                title={cart.scPwd ? "SC/PWD can't be combined with another discount." : undefined}
              >
                Amount
              </Button>
            </span>
            <span className="font-semibold tabular">-{formatPeso(regularDiscount)}</span>
          </div>
          {cart.orderDiscount ? (
            <p className="text-[13px] text-muted-foreground">Order: {describeDiscount(cart.orderDiscount)}</p>
          ) : null}
          {cart.orderDiscountError ? <p className="text-[13px] font-medium text-danger">{cart.orderDiscountError}</p> : null}
          {cart.scPwd ? (
            <div className="flex flex-col gap-1 text-danger">
              <p className="text-[13px] text-muted-foreground">{describeScPwd(cart.scPwd)}</p>
              {cart.scPwd.vat_exempt ? (
                <Row label="VAT exempted" value={`-${formatPeso(pricing.sc_pwd_vat_relief_cents)}`} />
              ) : null}
              <Row label={SC_PWD_DISCOUNT_LABEL} value={`-${formatPeso(pricing.sc_pwd_discount_cents)}`} />
            </div>
          ) : null}
          {cart.scPwdError ? <p className="text-[13px] font-medium text-danger">{cart.scPwdError}</p> : null}
          {SHOW_VAT_BREAKDOWN ? (
            <Row label="VAT included" value={formatPeso(pricing.vat_amount_cents)} className="text-muted-foreground" />
          ) : null}
          {cart.serviceCharge && cart.serviceChargeCents > 0 ? (
            <Row label={serviceChargeLabel(cart.serviceCharge.bps)} value={formatPeso(cart.serviceChargeCents)} />
          ) : null}
          <div className="mt-1 flex items-center justify-between border-y border-border py-3">
            <span className="text-lg font-bold">Total</span>
            <span className="text-2xl font-bold text-green tabular">{formatPeso(pricing.total_cents)}</span>
          </div>
          {cart.splitCount ? (
            <p className="text-[13px] text-muted-foreground">
              Split {cart.splitCount} ways:{' '}
              {equalSplitShares(pricing.total_cents, cart.splitCount)
                .map((share) => formatPeso(share))
                .join(' / ')}
            </p>
          ) : null}
          {needsApproval ? <p className="text-[13px] text-warning">This discount needs a manager's approval at checkout.</p> : null}
        </div>
      ) : null}

      {cart.cartError ? <Banner>{cart.cartError}</Banner> : null}

      {variant === 'round' ? (
        <Button variant="green" size="xl" className="w-full" disabled={cart.isEmpty || busy || disabled} onClick={onCheckout}>
          {busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <ChefHatIcon aria-hidden="true" />}
          {busy ? 'Sending…' : locked ? 'Send again' : 'Send to kitchen'}
        </Button>
      ) : (
        <Button variant="green" size="xl" className="w-full" disabled={cart.isEmpty || cart.hasProblems || disabled} onClick={onCheckout}>
          {cart.isEmpty
            ? variant === 'settle'
              ? 'Nothing to pay'
              : 'Cart is empty'
            : `${variant === 'settle' ? 'Pay' : 'Checkout'} (${formatPeso(pricing.total_cents)})`}
          {cart.isEmpty ? null : <Kbd className="border-transparent bg-green-hover text-white">F2</Kbd>}
        </Button>
      )}
      {cart.lines.length > 0 && variant !== 'settle' ? (
        <Button variant="ghost" className="w-full text-destructive hover:bg-danger-bg" onClick={editors.requestClear} disabled={busy}>
          <TrashIcon aria-hidden="true" />
          {variant === 'round' ? 'Clear round' : 'Clear cart'}
        </Button>
      ) : null}
    </Card>
  );
}

function CartLineBox({
  line,
  cart,
  editors,
  locked,
  variant,
}: {
  line: CartLine;
  cart: CartView;
  editors: CartEditors;
  locked: boolean;
  variant: CartVariant;
}) {
  const index = cart.lines.findIndex((entry) => entry.key === line.key);
  const priced = cart.pricing.lines[index];
  const error = cart.lineErrors[line.key];
  const useStore = useActiveCartStore();
  const lastAdded = useStore((state) => state.lastAdded);
  const flashKey = lastAdded && lastAdded.key === line.key ? lastAdded.at : null;

  const each = `${formatPeso(line.product.price_cents)} each`;
  const detail = variant === 'settle' ? (line.maxQty ? `${each} · ${line.maxQty} left to pay` : each) : (line.notes ?? each);

  return (
    <div
      className={cn(
        'relative isolate flex flex-col gap-2 rounded-lg border border-border p-3',
        error && 'border-danger-border',
      )}
    >
      {/* sell.md: the line highlights for 600 ms after an add (restarted by the key). */}
      {flashKey !== null ? <span key={flashKey} aria-hidden="true" className="pos-flash pointer-events-none absolute inset-0 -z-10 rounded-lg" /> : null}
      <div className="flex items-start gap-2">
        <ProductImage imageUrl={line.product.image_url} imagePath={line.product.image_path} className="size-11 shrink-0" />
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left hover:underline disabled:no-underline"
          onClick={() => editors.editLine(line)}
          disabled={locked}
          aria-label={`Edit ${line.product.name}`}
        >
          <span className="block truncate font-medium">{line.product.name}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>
          {line.discount ? <span className="block text-[13px] text-danger">{describeDiscount(line.discount)}</span> : null}
          {cart.itemsMode && line.scPwd ? (
            <Badge tone="neutral" className="mt-1">
              SC/PWD
            </Badge>
          ) : null}
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => useStore.getState().removeLine(line.key)}
          disabled={locked}
          aria-label={`Remove ${line.product.name}`}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-green tabular">{formatPeso(line.product.price_cents)}</span>
        <QtyStepper
          value={line.qty}
          onChange={(qty) => useStore.getState().setQty(line.key, qty)}
          label={`quantity of ${line.product.name}`}
          max={line.maxQty ?? 999}
          size="sm"
          disabled={locked}
        />
        <span className="text-sm font-bold text-green tabular">{formatPeso(priced?.net_cents ?? line.product.price_cents * line.qty)}</span>
      </div>
      {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
    </div>
  );
}
