/**
 * The POS (Sell) screen (design-system/pos/pages/sell.md): the band with the
 * Search group, the category tiles and the product grid on the left, the
 * Current Order card always visible on the right (below ~1000 px it moves
 * under the menu, with a sticky bottom bar showing the total and Checkout).
 *
 * Keyboard: `/` search, arrows move between products, `Enter` adds the
 * highlighted product, `F2` opens checkout, `Esc` closes dialogs.
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/misc';
import { useCart } from '@/hooks/sell/useCart';
import { useCartEditors } from '@/hooks/sell/useCartEditors';
import { useCheckout } from '@/hooks/sell/useCheckout';
import { useFilteredProducts, useMenu } from '@/hooks/useMenu';
import { useStockBadges } from '@/hooks/useStockBadges';
import { useCartStore } from '@/stores/cart';
import type { Order, Shift } from '@/services/types';
import { formatPeso } from '@pos/core/money';

import { ClearCartDialog, CustomerDialog, LineEditorDialog, OrderDiscountDialog, TableDialog } from './CartDialogs';
import { CheckoutDialog } from './CheckoutDialog';
import { CurrentOrderCard } from './CurrentOrderCard';
import { CategoryTiles, ProductGrid, SearchBar } from './MenuColumn';
import { SaleCompleteDialog } from './SaleCompleteDialog';
import { ScPwdDialog } from './ScPwdDialog';
import { KeyboardHints } from './SellParts';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function SellScreen({ shift }: { shift: Shift }) {
  const menu = useMenu();
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completed, setCompleted] = useState<{ order: Order; note: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const products = useFilteredProducts(menu.products, search.trim() !== '' ? null : categoryId, search);
  const cart = useCart();
  const stockBadges = useStockBadges();
  const editors = useCartEditors();
  const checkout = useCheckout({
    shiftUlid: shift.ulid,
    onCompleted: (order, note) => {
      setCheckoutOpen(false);
      setCompleted({ order, note });
    },
    onBackToCart: () => setCheckoutOpen(false),
  });

  const anyDialogOpen =
    checkoutOpen ||
    completed !== null ||
    editors.lineDraft !== null ||
    editors.orderDraft !== null ||
    editors.tableDraft !== null ||
    editors.customerPickerOpen ||
    editors.clearOpen ||
    editors.scPwd.draft !== null;

  function openCheckout() {
    if (cart.isEmpty || cart.hasProblems) return;
    // Checkout opens: the pending sale ULID is made now (and kept until a 201).
    useCartStore.getState().beginCheckout();
    setCheckoutOpen(true);
  }

  // `/` focuses search; `F2` opens checkout (never while a dialog is open or while typing for `/`).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (anyDialogOpen) return;
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'F2') {
        event.preventDefault();
        openCheckout();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const safeHighlight = Math.min(highlight, Math.max(0, products.length - 1));

  function addHighlighted() {
    const product = products[safeHighlight];
    if (product) editors.addProduct(product, 1);
  }

  return (
    <div className="@container relative">
      <div aria-hidden="true" className="pos-band pointer-events-none absolute inset-x-0 top-0 h-[280px] rounded-md" />
      <div className="relative flex flex-wrap items-start gap-4 p-4 pb-24 md:p-6 @min-[1004px]:pb-6">
        <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-5">
          <SearchBar
            ref={searchRef}
            value={search}
            onChange={(value) => {
              setSearch(value);
              setHighlight(0);
            }}
            onEnter={addHighlighted}
            onArrowDown={() => setFocusRequest((value) => value + 1)}
          />
          <CategoryTiles
            categories={menu.categories}
            activeId={categoryId}
            onSelect={(id) => {
              setCategoryId(id);
              setSearch('');
              setHighlight(0);
            }}
            loading={menu.loading}
          />
          <ProductGrid
            products={products}
            loading={menu.loading}
            error={menu.error}
            onRetry={menu.reload}
            highlight={safeHighlight}
            onHighlight={setHighlight}
            onAdd={(product, qty) => editors.addProduct(product, qty)}
            focusRequest={focusRequest}
            searching={search.trim() !== ''}
            locked={cart.awaitingConfirmation}
            badges={stockBadges}
          />
          <KeyboardHints />
        </div>

        <div className="w-full flex-[1_1_340px] @min-[1004px]:max-w-[440px]">
          <CurrentOrderCard cart={cart} editors={editors} onCheckout={openCheckout} needsApproval={cart.needsApproval} />
        </div>
      </div>

      {/* Below ~1000 px of content width the order card sits under the menu: the total and Checkout stay in reach. */}
      <div className="fixed inset-x-2 bottom-2 z-30 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-tile @min-[1004px]:hidden">
        <span className="text-sm">
          {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} ·{' '}
          <span className="text-lg font-bold text-green tabular">{formatPeso(cart.pricing.total_cents)}</span>
        </span>
        <Button variant="green" size="lg" disabled={cart.isEmpty || cart.hasProblems} onClick={openCheckout}>
          Checkout
          <Kbd className="border-transparent bg-green-hover text-white">F2</Kbd>
        </Button>
      </div>

      <LineEditorDialog editors={editors} />
      <OrderDiscountDialog editors={editors} />
      <TableDialog editors={editors} />
      <CustomerDialog editors={editors} />
      <ClearCartDialog editors={editors} />
      <ScPwdDialog editor={editors.scPwd} />
      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} checkout={checkout} />
      <SaleCompleteDialog
        order={completed?.order ?? null}
        note={completed?.note ?? null}
        onNewSale={() => {
          setCompleted(null);
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }}
      />
    </div>
  );
}
