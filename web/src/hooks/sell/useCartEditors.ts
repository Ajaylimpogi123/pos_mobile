/**
 * The Sell screen's cart UI state (ported from the tablet's `useCartEditors`):
 * the line editor, the order-discount editor, the customer picker, the table
 * dialog, the clear confirmation, add notices and the SC/PWD dialog. The cart
 * itself lives in the active cart store (`useActiveCartStore`).
 */
import { useState } from 'react';

import { useScPwdEditor } from '@/hooks/sell/useScPwdEditor';
import { discountDraftFrom, resolveDiscountDraft, type DiscountDraft } from '@pos/core/sale/discountRules';
import { priceCart } from '@pos/core/sale/order';
import { lineDiscountAllowed } from '@pos/core/sale/scPwd';
import { parseTableNo } from '@pos/core/sale/table';
import type { Product } from '@/services/types';
import { CART_LIMITS, cartProductFrom, useActiveCartStore, type CartCustomer, type CartLine } from '@/stores/cart';

export type LineDraft = {
  key: string;
  name: string;
  unitPriceCents: number;
  qty: string;
  discount: DiscountDraft;
  notes: string;
  errors: { qty?: string; discount?: string };
  /** Why the line's discount fields are hidden (SC/PWD). */
  discountLock: string | null;
  /** The most this line can take (a dine-in settlement line: the item's remaining quantity). */
  maxQty: number;
};

export type OrderDiscountDraft = {
  discount: DiscountDraft;
  error: string | null;
};

const ADD_NOTICES = {
  maxLines: `A sale can have up to ${CART_LIMITS.maxLines} lines.`,
  maxQty: `Up to ${CART_LIMITS.maxQty} of one item per line.`,
  locked: "The last sale attempt isn't confirmed yet. Retry it from checkout before changing the cart.",
  unavailable: 'This product is unavailable.',
} as const;

export const SC_PWD_LINE_LOCK = 'SC/PWD item: no other discount.';
export const SHARED_MEAL_LOCK = 'Shared meal with SC/PWD: no other discount.';

/** "12" → 12 when it is a whole number from 1 to 999, else `null`. */
export function parseQty(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const qty = Number(trimmed);
  return qty >= 1 && qty <= CART_LIMITS.maxQty ? qty : null;
}

export function useCartEditors() {
  const useStore = useActiveCartStore();
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null);
  const [orderDraft, setOrderDraft] = useState<OrderDiscountDraft | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [tableDraft, setTableDraft] = useState<{ text: string; error: string | null } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scPwd = useScPwdEditor();

  /** Adds `qty` of a product; `true` when it went into the cart. */
  function addProduct(product: Product, qty = 1): boolean {
    const result = useStore.getState().addProduct(cartProductFrom(product), qty);
    if (result === 'added' || result === 'incremented') {
      setNotice(null);
      return true;
    }
    setNotice(ADD_NOTICES[result]);
    return false;
  }

  function editLine(line: CartLine) {
    const cartScPwd = useStore.getState().scPwd;
    let discountLock: string | null = null;
    if (!lineDiscountAllowed(cartScPwd, line.scPwd)) {
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
      maxQty: Math.min(CART_LIMITS.maxQty, line.maxQty ?? CART_LIMITS.maxQty),
    });
  }

  function saveLine() {
    if (!lineDraft) return;
    const parsed = parseQty(lineDraft.qty);
    const qty = parsed !== null && parsed <= lineDraft.maxQty ? parsed : null;
    const errors: LineDraft['errors'] = {};
    if (qty === null) errors.qty = `Enter a quantity from 1 to ${lineDraft.maxQty}.`;
    const discountDraft = lineDraft.discountLock ? { ...lineDraft.discount, enabled: false } : lineDraft.discount;
    const resolved = resolveDiscountDraft(discountDraft, lineDraft.unitPriceCents * (qty ?? 1));
    if (resolved.error !== null) errors.discount = resolved.error;
    if (qty === null || resolved.error !== null) {
      setLineDraft({ ...lineDraft, errors });
      return;
    }
    useStore.getState().updateLine(lineDraft.key, { qty, discount: resolved.discount, notes: lineDraft.notes });
    setLineDraft(null);
  }

  function editOrderDiscount() {
    // No double discount: an order with SC/PWD takes no order discount.
    if (useStore.getState().scPwd) return;
    const current = useStore.getState().orderDiscount;
    setOrderDraft({ discount: { ...discountDraftFrom(current), enabled: true }, error: null });
  }

  function saveOrderDiscount() {
    if (!orderDraft) return;
    const cart = useStore.getState();
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

  function saveTable() {
    if (!tableDraft) return;
    const parsed = parseTableNo(tableDraft.text);
    if (parsed.error) {
      setTableDraft({ ...tableDraft, error: parsed.error });
      return;
    }
    useStore.getState().setTableNo(parsed.value ?? '');
    setTableDraft(null);
  }

  return {
    notice,
    dismissNotice: () => setNotice(null),
    addProduct,
    lineDraft,
    editLine,
    changeLineDraft: (changes: Partial<Pick<LineDraft, 'qty' | 'discount' | 'notes'>>) =>
      setLineDraft((draft) => (draft ? { ...draft, ...changes, errors: {} } : draft)),
    saveLine,
    removeDraftLine: () => {
      if (!lineDraft) return;
      useStore.getState().removeLine(lineDraft.key);
      setLineDraft(null);
    },
    cancelLine: () => setLineDraft(null),
    orderDraft,
    editOrderDiscount,
    changeOrderDraft: (discount: DiscountDraft) => setOrderDraft({ discount, error: null }),
    saveOrderDiscount,
    removeOrderDiscount: () => {
      useStore.getState().setOrderDiscount(null);
      setOrderDraft(null);
    },
    cancelOrderDiscount: () => setOrderDraft(null),
    customerPickerOpen,
    openCustomerPicker: () => setCustomerPickerOpen(true),
    closeCustomerPicker: () => setCustomerPickerOpen(false),
    chooseCustomer: (customer: CartCustomer | null) => {
      useStore.getState().setCustomer(customer);
      setCustomerPickerOpen(false);
    },
    tableDraft,
    editTable: () => setTableDraft({ text: useStore.getState().tableNo, error: null }),
    changeTable: (text: string) => setTableDraft({ text, error: null }),
    saveTable,
    clearTable: () => {
      useStore.getState().setTableNo('');
      setTableDraft(null);
    },
    cancelTable: () => setTableDraft(null),
    clearOpen,
    requestClear: () => setClearOpen(true),
    cancelClear: () => setClearOpen(false),
    confirmClear: () => {
      useStore.getState().clear();
      setClearOpen(false);
      setNotice(null);
    },
    scPwd,
  };
}

export type CartEditors = ReturnType<typeof useCartEditors>;
