import { createContext, useContext } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { TenderDraft } from '@pos/core/sale/payments';
import { lineDiscountAllowed, scPwdConflicts } from '@pos/core/sale/scPwd';
import type { Product, SaleDiscount, ScPwdRequest } from '@/services/types';
import { ulid } from '@/utils/ulid';
import type {
  CartCustomer,
  CartLine as CoreCartLine,
  CartProduct as CoreCartProduct,
  ServerCartErrors,
} from '@pos/core/sale/cart';

export type { CartCustomer, ServerCartErrors };

/** The shared cart product plus the image the web Sell screen shows. */
export type CartProduct = CoreCartProduct & {
  image_url: string | null;
  image_path: string | null;
};

export type CartLine = Omit<CoreCartLine, 'product'> & {
  product: CartProduct;
  /** Dine-in settlement: the tab item this line pays for (`items[].tab_item_id`). */
  tabItemId?: number;
  /** Dine-in settlement: the most this line can take (the item's `remaining_qty`). */
  maxQty?: number;
};

/** Dine-in settlement (§E): the branch's service charge and the checkout's toggle. */
export type CartServiceCharge = { bps: number; on: boolean };

/**
 * The cart (docs/api-contract.md → Core Sale → App; Web POS §F), ported from
 * the tablet's `mobile/src/stores/cart.ts` with the same rules. Terminal
 * state, in memory only: it never touches the server; checkout sends it as
 * one `POST /api/v1/orders`.
 *
 * - Lines hold a snapshot of the product from `GET /products`, plus `qty`, an
 *   optional line discount and a note. Adding a product increments an existing
 *   line for that product with no discount, no note and no SC/PWD mark
 *   (Q-023), else starts a new line. The web card adds its stepper's quantity.
 * - The order discount, an optional customer, an optional table number (as
 *   typed), and the **pending sale ULID**: made when checkout opens, reused on
 *   every retry, dropped only when the sale is created (201) or the cart is cleared.
 * - The payments as typed at checkout (`tender`), so closing checkout and
 *   opening it again keeps them.
 * - `awaitingConfirmation`: the last attempt got no answer (network error or
 *   timeout), so it may have gone through. Until a retry gets an answer, the
 *   cart and the payments are locked: a retry must send the same body with the
 *   same ULID (Global Conventions → Idempotent requests). Clearing is still possible.
 * - Server messages (e.g. a stock `422`) are kept per line and cleared as soon
 *   as that line changes or the next attempt is sent.
 * - SC/PWD: the sale's `scPwd` and each line's mark (`items` mode). No double
 *   discount: applying SC/PWD removes the discounts it can't be combined with
 *   (the dialog asks first).
 */

/** Contract limits: `items` max 100, `qty` 1–999, line `notes` max 120. */
export const CART_LIMITS = { maxLines: 100, maxQty: 999, lineNotesMax: 120 } as const;

/** The snapshot of a `GET /products` item (explicit picks: nothing else is kept). */
export function cartProductFrom(product: Product): CartProduct {
  return {
    id: product.id,
    category_id: product.category.id,
    name: product.name,
    sku: product.sku,
    price_cents: product.price_cents,
    is_vatable: product.is_vatable,
    is_available: product.is_available,
    track_stock: product.track_stock,
    image_url: product.image_url,
    image_path: product.image_path,
  };
}

/** What adding a product did. */
export type AddResult = 'added' | 'incremented' | 'unavailable' | 'maxQty' | 'maxLines' | 'locked';

export type LineChanges = {
  qty: number;
  discount: SaleDiscount | null;
  notes: string | null;
};

type CartData = {
  lines: CartLine[];
  orderDiscount: SaleDiscount | null;
  customer: CartCustomer | null;
  /** As typed (`''`: none). Checked and trimmed when the sale is sent. */
  tableNo: string;
  pendingUlid: string | null;
  tender: TenderDraft;
  lineErrors: Record<string, string>;
  orderDiscountError: string | null;
  customerError: string | null;
  tableError: string | null;
  scPwd: ScPwdRequest | null;
  scPwdErrors: Record<string, string>;
  cartError: string | null;
  awaitingConfirmation: boolean;
  /** The line the last add touched (the 600 ms highlight). */
  lastAdded: { key: string; at: number } | null;
  /** Dine-in settlement only: the service charge (`null` on a pay-now sale and a round). */
  serviceCharge: CartServiceCharge | null;
  /** Dine-in settlement only (T2): split equally into 2–10 shares, or `null`. */
  splitCount: number | null;
};

type CartActions = {
  addProduct: (product: CartProduct, qty?: number) => AddResult;
  setQty: (key: string, qty: number) => void;
  updateLine: (key: string, changes: LineChanges) => void;
  removeLine: (key: string) => void;
  setOrderDiscount: (discount: SaleDiscount | null) => void;
  setCustomer: (customer: CartCustomer | null) => void;
  setTableNo: (text: string) => void;
  applyScPwd: (scPwd: ScPwdRequest, markedKeys: readonly string[]) => void;
  removeScPwd: () => void;
  /** Empties the cart and drops the pending ULID (a fresh sale). */
  clear: () => void;
  /** Checkout opens: returns the pending sale ULID, making it the first time. */
  beginCheckout: () => string;
  setTender: (tender: TenderDraft) => void;
  setAwaitingConfirmation: (awaiting: boolean) => void;
  showServerErrors: (errors: ServerCartErrors) => void;
  clearServerErrors: () => void;
  /** Replaces the product snapshots of matching lines with fresh menu rows (after the checksum 422). */
  repriceProducts: (products: readonly CartProduct[]) => void;
  /** The sale was created (201): a new sale starts with a new ULID. */
  completeSale: () => void;
  /** Dine-in: starts a settlement with these tab lines (a fresh cart and ULID). */
  loadSettlement: (input: { lines: CartLine[]; tableNo: string; serviceCharge: CartServiceCharge; splitCount: number | null }) => void;
  setServiceChargeOn: (on: boolean) => void;
  setSplitCount: (count: number | null) => void;
};

export type CartState = CartData & CartActions;

function emptyCart(): CartData {
  return {
    lines: [],
    orderDiscount: null,
    customer: null,
    tableNo: '',
    pendingUlid: null,
    tender: { cash: '', gcash: [] },
    lineErrors: {},
    orderDiscountError: null,
    customerError: null,
    tableError: null,
    scPwd: null,
    scPwdErrors: {},
    cartError: null,
    awaitingConfirmation: false,
    lastAdded: null,
    serviceCharge: null,
    splitCount: null,
  };
}

let nextLineNumber = 1;

function newLineKey(): string {
  const key = `line-${nextLineNumber}`;
  nextLineNumber += 1;
  return key;
}

function clampQty(qty: number, max: number = CART_LIMITS.maxQty): number {
  return Math.min(max, CART_LIMITS.maxQty, Math.max(1, Math.trunc(qty)));
}

function withoutError(errors: Record<string, string>, key: string): Record<string, string> {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/** A cart store: the pay-now cart, a dine-in round, or a dine-in settlement (each its own instance). */
export type CartStore = UseBoundStore<StoreApi<CartState>>;

export function createCartStore(): CartStore {
  return create<CartState>()((set, get) => ({
  ...emptyCart(),

  addProduct: (product, qty = 1) => {
    const state = get();
    if (state.awaitingConfirmation) return 'locked';
    if (!product.is_available) return 'unavailable';
    const amount = clampQty(qty);

    // Q-023: an SC/PWD-marked line isn't topped up (the new unit may be for someone else).
    const existing = state.lines.find(
      (line) => line.product.id === product.id && line.discount === null && line.notes === null && !line.scPwd,
    );
    if (existing) {
      if (existing.qty >= CART_LIMITS.maxQty) return 'maxQty';
      set({
        lines: state.lines.map((line) => (line.key === existing.key ? { ...line, qty: clampQty(line.qty + amount, line.maxQty) } : line)),
        lineErrors: withoutError(state.lineErrors, existing.key),
        cartError: null,
        lastAdded: { key: existing.key, at: Date.now() },
      });
      return 'incremented';
    }

    if (state.lines.length >= CART_LIMITS.maxLines) return 'maxLines';
    const key = newLineKey();
    set({
      lines: [...state.lines, { key, product, qty: amount, discount: null, notes: null, scPwd: false }],
      cartError: null,
      lastAdded: { key, at: Date.now() },
    });
    return 'added';
  },

  setQty: (key, qty) => {
    const state = get();
    if (state.awaitingConfirmation) return;
    set({
      lines: state.lines.map((line) => (line.key === key ? { ...line, qty: clampQty(qty, line.maxQty) } : line)),
      lineErrors: withoutError(state.lineErrors, key),
      cartError: null,
    });
  },

  updateLine: (key, changes) => {
    const state = get();
    if (state.awaitingConfirmation) return;
    const notes = changes.notes?.trim() ? changes.notes.trim().slice(0, CART_LIMITS.lineNotesMax) : null;
    set({
      lines: state.lines.map((line) =>
        line.key === key
          ? {
              ...line,
              qty: clampQty(changes.qty, line.maxQty),
              // No double discount: an SC/PWD line (any line of a shared meal) takes no line discount.
              discount: lineDiscountAllowed(state.scPwd, line.scPwd) ? changes.discount : null,
              notes,
            }
          : line,
      ),
      lineErrors: withoutError(state.lineErrors, key),
      cartError: null,
    });
  },

  removeLine: (key) => {
    const state = get();
    if (state.awaitingConfirmation) return;
    const lines = state.lines.filter((line) => line.key !== key);
    set({
      lines,
      lineErrors: withoutError(state.lineErrors, key),
      cartError: null,
      // An empty cart has no SC/PWD left to apply (Q-023).
      ...(lines.length === 0 ? { scPwd: null, scPwdErrors: {} } : null),
    });
  },

  setOrderDiscount: (discount) => {
    const state = get();
    if (state.awaitingConfirmation) return;
    if (state.scPwd && discount) return;
    set({ orderDiscount: discount, orderDiscountError: null, cartError: null });
  },

  applyScPwd: (scPwd, markedKeys) => {
    const state = get();
    if (state.awaitingConfirmation || state.lines.length === 0) return;
    const marked = new Set(scPwd.mode === 'items' ? markedKeys : []);
    const conflicts = scPwdConflicts(state.lines, state.orderDiscount, scPwd.mode, marked);
    const stripped = new Set(conflicts.lineKeys);
    set({
      scPwd: {
        mode: scPwd.mode,
        persons: scPwd.persons.map((person) => ({ type: person.type, id_no: person.id_no })),
        diners: scPwd.mode === 'headcount' ? scPwd.diners : null,
        vat_exempt: scPwd.vat_exempt,
      },
      lines: state.lines.map((line) => ({
        ...line,
        scPwd: marked.has(line.key),
        discount: stripped.has(line.key) ? null : line.discount,
      })),
      orderDiscount: null,
      orderDiscountError: null,
      scPwdErrors: {},
      cartError: null,
    });
  },

  removeScPwd: () => {
    const state = get();
    if (state.awaitingConfirmation) return;
    set({
      scPwd: null,
      lines: state.lines.map((line) => (line.scPwd ? { ...line, scPwd: false } : line)),
      scPwdErrors: {},
      cartError: null,
    });
  },

  setCustomer: (customer) => {
    if (get().awaitingConfirmation) return;
    set({ customer, customerError: null });
  },

  setTableNo: (text) => {
    if (get().awaitingConfirmation) return;
    set({ tableNo: text, tableError: null });
  },

  clear: () => set(emptyCart()),

  beginCheckout: () => {
    const current = get().pendingUlid;
    if (current) return current;
    const created = ulid();
    set({ pendingUlid: created });
    return created;
  },

  setTender: (tender) => {
    if (get().awaitingConfirmation) return;
    set({ tender });
  },

  setAwaitingConfirmation: (awaiting) => set({ awaitingConfirmation: awaiting }),

  clearServerErrors: () =>
    set({ lineErrors: {}, orderDiscountError: null, customerError: null, tableError: null, scPwdErrors: {}, cartError: null }),

  showServerErrors: (errors) =>
    set((state) => {
      const lineErrors: Record<string, string> = {};
      for (const [index, message] of Object.entries(errors.lines)) {
        const line = state.lines[Number(index)];
        if (line) lineErrors[line.key] = message;
      }
      return {
        lineErrors,
        orderDiscountError: errors.orderDiscount,
        customerError: errors.customer,
        tableError: errors.table ?? null,
        scPwdErrors: errors.scPwd ?? {},
        cartError: errors.cart,
      };
    }),

  repriceProducts: (products) =>
    set((state) => {
      const byId = new Map(products.map((product) => [product.id, product]));
      return {
        lines: state.lines.map((line) => {
          const fresh = byId.get(line.product.id);
          return fresh ? { ...line, product: fresh } : line;
        }),
      };
    }),

  completeSale: () => set(emptyCart()),

  loadSettlement: ({ lines, tableNo, serviceCharge, splitCount }) =>
    set({ ...emptyCart(), lines, tableNo, serviceCharge, splitCount }),

  setServiceChargeOn: (on) => {
    const state = get();
    if (state.awaitingConfirmation || !state.serviceCharge) return;
    set({ serviceCharge: { ...state.serviceCharge, on }, cartError: null });
  },

  setSplitCount: (count) => {
    if (get().awaitingConfirmation) return;
    set({ splitCount: count, cartError: null });
  },
  }));
}

/** The pay-now cart (the Sell screen's "Pay now"). */
export const useCartStore = createCartStore();

/** Dine-in: the round being built on a tab screen (sent with **Send to kitchen**). */
export const useRoundCartStore = createCartStore();

/** Dine-in: the settlement of a tab (the tab's lines, discounts and payments at **Pay**). */
export const useSettleCartStore = createCartStore();

/** The cart store the Sell hooks and components work on (the pay-now cart unless a provider says otherwise). */
export const CartStoreContext = createContext<CartStore>(useCartStore);

export function useActiveCartStore(): CartStore {
  return useContext(CartStoreContext);
}

/** Sign-out: every cart is emptied. */
export function clearAllCarts(): void {
  useCartStore.getState().clear();
  useRoundCartStore.getState().clear();
  useSettleCartStore.getState().clear();
}
