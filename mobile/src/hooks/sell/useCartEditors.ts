import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { ROUTES } from '@/constants/routes';
import type { MenuProduct } from '@/db/menuQueries';
import { discountDraftFrom, resolveDiscountDraft, type DiscountDraft } from '@pos/core/sale/discountRules';
import { useScPwdEditor } from '@/hooks/sell/useScPwdEditor';
import { priceCart } from '@pos/core/sale/order';
import { lineDiscountAllowed } from '@pos/core/sale/scPwd';
import { CART_LIMITS, cartProductFrom, useCartStoreApi, type CartCustomer, type CartLine } from '@/stores/cart';

/** The line editor's draft: applied to the cart only on Save. */
export type LineDraft = {
  key: string;
  name: string;
  unitPriceCents: number;
  qty: string;
  discount: DiscountDraft;
  notes: string;
  errors: { qty?: string; discount?: string };
  /**
   * Senior Citizen / PWD Discount: why this line takes no line discount (an
   * SC/PWD line, or any line of a shared meal), or `null`. The editor hides
   * the discount fields then.
   */
  discountLock: string | null;
};

export type OrderDiscountDraft = {
  discount: DiscountDraft;
  error: string | null;
};

/** The product a tap last added (its cart line highlights); `token` changes on every add. */
export type LineHighlight = { productId: number | null; token: number };

const ADD_NOTICES = {
  maxLines: `A sale can have up to ${CART_LIMITS.maxLines} lines.`,
  maxQty: `Up to ${CART_LIMITS.maxQty} of one item per line.`,
  locked: "The last sale attempt isn't confirmed yet. Retry it from checkout before changing the cart.",
} as const;

/** Senior Citizen / PWD Discount: why a line's discount fields are hidden. */
export const SC_PWD_LINE_LOCK = 'SC/PWD item: no other discount.';
export const SHARED_MEAL_LOCK = 'Shared meal with SC/PWD: no other discount.';
/** Dine-in: a round sent to the kitchen carries no discounts; they are given when the bill is paid. */
export const ROUND_LINE_LOCK = 'Discounts are given when the bill is paid.';

/** "12" → 12 when it is a whole number from 1 to 999, else `null`. */
export function parseQty(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const qty = Number(trimmed);
  return qty >= 1 && qty <= CART_LIMITS.maxQty ? qty : null;
}

/**
 * The Sell screen's cart UI state: the cart sheet (phones and portrait), the
 * line editor, the order-discount editor, the customer picker, the clear
 * confirmation, tile-tap notices and the SC/PWD sheet. It lives in the Sell screen above every
 * layout switch, so an open editor and its typed values survive rotation.
 * The cart itself lives in `useCartStore`.
 */
export function useCartEditors(options: { lineDiscounts?: boolean } = {}) {
  const useCartStore = useCartStoreApi();
  const lineDiscounts = options.lineDiscounts !== false;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null);
  const [orderDraft, setOrderDraft] = useState<OrderDiscountDraft | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // sell.md: the cart line a tap just added to highlights for 600 ms (the token changes on every add).
  const [highlight, setHighlight] = useState<LineHighlight>({ productId: null, token: 0 });
  const scPwd = useScPwdEditor();

  // Checkout sent the cashier back to the cart (e.g. a stock 422): open the sheet once the Sell
  // screen is focused again (never while checkout is still on top). The side panel is always visible.
  const showCartRequest = useCartStore((state) => state.showCartRequest);
  const handledRequest = useRef(showCartRequest);
  useFocusEffect(
    useCallback(() => {
      if (showCartRequest === handledRequest.current) return;
      handledRequest.current = showCartRequest;
      setSheetOpen(true);
    }, [showCartRequest]),
  );

  /** Adds one; true when the cart took it (the card then says "Added" and the line highlights). */
  function addProduct(product: MenuProduct): boolean {
    const result = useCartStore.getState().addProduct(cartProductFrom(product));
    if (result === 'maxLines' || result === 'maxQty' || result === 'locked') setNotice(ADD_NOTICES[result]);
    else setNotice(null);
    const added = result === 'added' || result === 'incremented';
    if (added) setHighlight((previous) => ({ productId: product.id, token: previous.token + 1 }));
    return added;
  }

  function editLine(line: CartLine) {
    const cartScPwd = useCartStore.getState().scPwd;
    let discountLock: string | null = null;
    if (!lineDiscounts) discountLock = ROUND_LINE_LOCK;
    else if (!lineDiscountAllowed(cartScPwd, line.scPwd)) {
      discountLock = cartScPwd?.mode === 'headcount' ? SHARED_MEAL_LOCK : SC_PWD_LINE_LOCK;
    }
    setLineDraft({
      key: line.key,
      name: line.product.name,
      unitPriceCents: line.product.price_cents,
      qty: String(line.qty),
      discount: discountDraftFrom(line.discount),
      notes: line.notes ?? '',
      errors: {},
      discountLock,
    });
  }

  function changeLineDraft(changes: Partial<Pick<LineDraft, 'qty' | 'discount' | 'notes'>>) {
    setLineDraft((draft) => (draft ? { ...draft, ...changes, errors: {} } : draft));
  }

  function saveLine() {
    if (!lineDraft) return;
    const qty = parseQty(lineDraft.qty);
    const errors: LineDraft['errors'] = {};
    if (qty === null) errors.qty = `Enter a quantity from 1 to ${CART_LIMITS.maxQty}.`;
    const discountDraft = lineDraft.discountLock ? { ...lineDraft.discount, enabled: false } : lineDraft.discount;
    const resolved = resolveDiscountDraft(discountDraft, lineDraft.unitPriceCents * (qty ?? 1));
    if (resolved.error !== null) errors.discount = resolved.error;
    if (qty === null || resolved.error !== null) {
      setLineDraft({ ...lineDraft, errors });
      return;
    }
    useCartStore.getState().updateLine(lineDraft.key, { qty, discount: resolved.discount, notes: lineDraft.notes });
    setLineDraft(null);
  }

  function removeDraftLine() {
    if (!lineDraft) return;
    useCartStore.getState().removeLine(lineDraft.key);
    setLineDraft(null);
  }

  function editOrderDiscount() {
    // No double discount: an order with SC/PWD takes no order discount.
    if (useCartStore.getState().scPwd) return;
    const current = useCartStore.getState().orderDiscount;
    setOrderDraft({ discount: { ...discountDraftFrom(current), enabled: true }, error: null });
  }

  function changeOrderDraft(discount: DiscountDraft) {
    setOrderDraft({ discount, error: null });
  }

  function saveOrderDiscount() {
    if (!orderDraft) return;
    const cart = useCartStore.getState();
    // The base is B = Σ line nets, before any order discount.
    const base = priceCart(cart.lines, null).discount_base_cents;
    const resolved = resolveDiscountDraft(orderDraft.discount, base);
    if (resolved.error !== null) {
      setOrderDraft({ ...orderDraft, error: resolved.error });
      return;
    }
    cart.setOrderDiscount(resolved.discount);
    setOrderDraft(null);
  }

  function removeOrderDiscount() {
    useCartStore.getState().setOrderDiscount(null);
    setOrderDraft(null);
  }

  function chooseCustomer(customer: CartCustomer | null) {
    useCartStore.getState().setCustomer(customer);
    setCustomerPickerOpen(false);
  }

  function confirmClear() {
    useCartStore.getState().clear();
    setClearOpen(false);
    setNotice(null);
  }

  /** Checkout starts: the pending sale ULID is generated now (and kept until a 201). */
  function checkout() {
    useCartStore.getState().beginCheckout();
    setSheetOpen(false);
    router.push(ROUTES.checkout);
  }

  return {
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    notice,
    highlight,
    dismissNotice: () => setNotice(null),
    addProduct,
    lineDraft,
    editLine,
    changeLineDraft,
    saveLine,
    removeDraftLine,
    cancelLine: () => setLineDraft(null),
    orderDraft,
    editOrderDiscount,
    changeOrderDraft,
    saveOrderDiscount,
    removeOrderDiscount,
    cancelOrderDiscount: () => setOrderDraft(null),
    customerPickerOpen,
    openCustomerPicker: () => setCustomerPickerOpen(true),
    closeCustomerPicker: () => setCustomerPickerOpen(false),
    chooseCustomer,
    clearOpen,
    requestClear: () => setClearOpen(true),
    cancelClear: () => setClearOpen(false),
    confirmClear,
    checkout,
    /** Senior Citizen / PWD Discount: the SC/PWD sheet. */
    scPwd,
  };
}

export type CartEditors = ReturnType<typeof useCartEditors>;
