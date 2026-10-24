/**
 * The two halves of the tab screen (Dine-in Tables & Tabs §I). Each is
 * rendered inside the `CartStoreContext` of its own cart, so the Sell hooks
 * and components work on it unchanged:
 *
 * - `RoundOrderingView` (the round cart): the Sell menu (search, category
 *   tiles, product grid) on the left; on the right the **New round** card
 *   (**Send to kitchen**) and **Bill items**.
 * - `SettlementView` (the settlement cart): the tab's lines with discounts,
 *   SC/PWD and customer, then the existing checkout (`F2`) with the service
 *   charge toggle and, for an equal split, one step per share.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Banner } from '@/components/common/Banner';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { ClearCartDialog, CustomerDialog, LineEditorDialog, OrderDiscountDialog } from '@/components/sell/CartDialogs';
import { CheckoutDialog } from '@/components/sell/CheckoutDialog';
import { CurrentOrderCard } from '@/components/sell/CurrentOrderCard';
import { CategoryTiles, ProductGrid, SearchBar } from '@/components/sell/MenuColumn';
import { SaleCompleteDialog } from '@/components/sell/SaleCompleteDialog';
import { ScPwdDialog } from '@/components/sell/ScPwdDialog';
import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/sell/useCart';
import { useCartEditors } from '@/hooks/sell/useCartEditors';
import { useCheckout } from '@/hooks/sell/useCheckout';
import { useFilteredProducts, useMenu } from '@/hooks/useMenu';
import { useStockBadges } from '@/hooks/useStockBadges';
import { useSendRound } from '@/hooks/useTab';
import type { Order, Shift, Tab } from '@/services/types';
import { useActiveCartStore } from '@/stores/cart';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** `true` while any Radix dialog is open (the screen's shortcuts stay off). */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

// ---------------------------------------------------------------------------
// Ordering: the menu, the new round and the bill items
// ---------------------------------------------------------------------------

type RoundOrderingViewProps = {
  tab: Tab;
  online: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onPay: () => void;
  onConflict: (message: string) => void;
  billItems: ReactNode;
};

export function RoundOrderingView({ tab, online, searchRef, onPay, onConflict, billItems }: RoundOrderingViewProps) {
  const menu = useMenu();
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const products = useFilteredProducts(menu.products, search.trim() !== '' ? null : categoryId, search);
  const cart = useCart();
  const editors = useCartEditors();
  const stockBadges = useStockBadges();
  const round = useSendRound(tab, onConflict);

  // `/` focuses search; `F2` opens Pay (never while a dialog is open or while typing for `/`).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dialogOpen()) return;
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'F2') {
        event.preventDefault();
        onPay();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPay, searchRef]);

  const safeHighlight = Math.min(highlight, Math.max(0, products.length - 1));

  return (
    <div className="@container">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-5">
          <SearchBar
            ref={searchRef}
            value={search}
            onChange={(value) => {
              setSearch(value);
              setHighlight(0);
            }}
            onEnter={() => {
              const product = products[safeHighlight];
              if (product) editors.addProduct(product, 1);
            }}
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
        </div>

        <div className="flex w-full flex-[1_1_340px] flex-col gap-4 @min-[1004px]:max-w-[440px]">
          {round.banner ? (
            <Banner
              variant="warning"
              actions={
                <Button variant="ghost" size="sm" onClick={round.dismissBanner}>
                  Dismiss
                </Button>
              }
            >
              {round.banner}
            </Banner>
          ) : null}
          <CurrentOrderCard
            cart={cart}
            editors={editors}
            onCheckout={() => void round.send()}
            needsApproval={false}
            variant="round"
            busy={round.busy}
            disabled={!online}
          />
          <PrintJobList
            tracker={round.printing.tracker}
            notices={round.printing.notices}
            unrouted={round.printing.unrouted}
            title="Kitchen tickets"
          />
          {billItems}
        </div>
      </div>

      <LineEditorDialog editors={editors} variant="round" />
      <ClearCartDialog editors={editors} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay: the settlement checkout
// ---------------------------------------------------------------------------

type SettlementViewProps = {
  tab: Tab;
  shift: Shift;
  onConflict: (message: string) => void;
  onSettledTab: (tab: Tab | null) => void;
  /** After the success view: `closed` when nothing is left on the bill. */
  onDone: (closed: boolean) => void;
};

export function SettlementView({ tab, shift, onConflict, onSettledTab, onDone }: SettlementViewProps) {
  const useStore = useActiveCartStore();
  const cart = useCart();
  const editors = useCartEditors();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completed, setCompleted] = useState<{ order: Order; note: string | null } | null>(null);
  const lastTab = useRef<Tab | null>(null);
  const checkout = useCheckout({
    shiftUlid: shift.ulid,
    onCompleted: (order, note) => {
      setCheckoutOpen(false);
      setCompleted({ order, note });
    },
    onBackToCart: () => setCheckoutOpen(false),
    settlement: {
      tabUlid: tab.ulid,
      onSettledTab: (updated) => {
        lastTab.current = updated;
        onSettledTab(updated);
      },
      onConflict: (message) => {
        setCheckoutOpen(false);
        onConflict(message);
      },
    },
  });

  function openCheckout() {
    if (cart.isEmpty || cart.hasProblems) return;
    // Pay opens: the settlement ULID is made now (and kept until a 201).
    useStore.getState().beginCheckout();
    setCheckoutOpen(true);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'F2' || dialogOpen()) return;
      event.preventDefault();
      if (cart.isEmpty || cart.hasProblems) return;
      useStore.getState().beginCheckout();
      setCheckoutOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cart.isEmpty, cart.hasProblems, useStore]);

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <CurrentOrderCard cart={cart} editors={editors} onCheckout={openCheckout} needsApproval={cart.needsApproval} variant="settle" />

      <LineEditorDialog editors={editors} variant="settle" />
      <OrderDiscountDialog editors={editors} />
      <CustomerDialog editors={editors} />
      <ScPwdDialog editor={editors.scPwd} />
      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} checkout={checkout} />
      <SaleCompleteDialog
        settlement
        order={completed?.order ?? null}
        note={completed?.note ?? null}
        onNewSale={() => {
          setCompleted(null);
          const updated = lastTab.current;
          lastTab.current = null;
          onDone(updated !== null && updated.status !== 'open');
        }}
      />
    </div>
  );
}
