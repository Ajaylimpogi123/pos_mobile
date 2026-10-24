import { createContext, useContext } from "react";
import { create } from "zustand";

import type { TenderDraft } from "@pos/core/sale/payments";
import { lineDiscountAllowed, scPwdConflicts } from "@pos/core/sale/scPwd";
import type { SaleDiscount, ScPwdRequest } from "@/services/types";
import { ulid } from "@/utils/ulid";
import type {
    CartCustomer,
    CartLine,
    CartProduct,
    ServerCartErrors,
} from "@pos/core/sale/cart";

export type { CartCustomer, CartLine, CartProduct, ServerCartErrors };

/**
 * The cart (docs/api-contract.md → Core Sale → App): device state, in memory
 * only (PROJECT_MEMORY §7.3). It never touches the server; checkout sends it
 * as one `POST /api/v1/orders`.
 *
 * - Lines hold a snapshot of the product from the on-device menu (SQLite),
 *   plus `qty`, an optional line discount and a note. Tapping a tile adds 1,
 *   or increments an existing line for that product with no discount and no note.
 * - The order discount, an optional customer, an optional table number (as
 *   typed; Table Number, Core Sale revision 2), and the **pending sale ULID**:
 *   generated when checkout starts, reused on every retry, and dropped only
 *   when the sale is created (201) or the cart is cleared.
 * - The payments as typed at checkout (`tender`), so leaving checkout and
 *   coming back keeps them.
 * - `awaitingConfirmation`: the last attempt got no answer (network error or
 *   timeout), so it may have gone through. Until a retry gets an answer, the
 *   cart and the payments are locked: a retry must send the same body with the
 *   same ULID (Global Conventions → Idempotent requests). Clearing is still possible.
 * - Server messages (e.g. a stock `422`) are kept per line, cleared as soon as
 *   that line changes or the next attempt is sent. They inform; the server
 *   checks again on every attempt.
 * - Senior Citizen / PWD Discount: the sale's `scPwd` (`{ mode, persons,
 *   diners, vat_exempt }`, or `null`) and each line's `scPwd` mark (`items`
 *   mode only). No double discount: applying SC/PWD removes the discounts it
 *   can't be combined with (the sheet asks first), and while it is set a
 *   marked line (or, in `headcount` mode, any line) takes no line discount
 *   and the order takes no order discount.
 */

/** Contract limits: `items` max 100, `qty` 1–999, line `notes` max 120. */
export const CART_LIMITS = {
    maxLines: 100,
    maxQty: 999,
    lineNotesMax: 120,
} as const;

/** The snapshot of an on-device menu row (explicit picks: nothing else is kept). */
export function cartProductFrom(row: CartProduct): CartProduct {
    return {
        id: row.id,
        category_id: row.category_id,
        name: row.name,
        sku: row.sku,
        price_cents: row.price_cents,
        is_vatable: row.is_vatable,
        is_available: row.is_available,
        track_stock: row.track_stock,
    };
}

/** What a tile tap did. */
export type AddResult =
    "added" | "incremented" | "unavailable" | "maxQty" | "maxLines" | "locked";

export type LineChanges = {
    qty: number;
    discount: SaleDiscount | null;
    notes: string | null;
};

type CartData = {
    lines: CartLine[];
    orderDiscount: SaleDiscount | null;
    customer: CartCustomer | null;
    /** The table number as typed (`''`: none). Checked and trimmed when the sale is sent. */
    tableNo: string;
    pendingUlid: string | null;
    /** The payments as typed at checkout. */
    tender: TenderDraft;
    /** Server messages by line key. */
    lineErrors: Record<string, string>;
    orderDiscountError: string | null;
    customerError: string | null;
    /** The server's message on `table_no`. */
    tableError: string | null;
    /** Senior Citizen / PWD Discount: the sale's SC/PWD, or `null`. */
    scPwd: ScPwdRequest | null;
    /** The server's messages on `sc_pwd` (see `ServerCartErrors.scPwd`). */
    scPwdErrors: Record<string, string>;
    cartError: string | null;
    awaitingConfirmation: boolean;
    /** Bumped when checkout sends the cashier back to the cart (the phone layout opens its sheet). */
    showCartRequest: number;
};

type CartActions = {
    addProduct: (product: CartProduct) => AddResult;
    setQty: (key: string, qty: number) => void;
    updateLine: (key: string, changes: LineChanges) => void;
    removeLine: (key: string) => void;
    setOrderDiscount: (discount: SaleDiscount | null) => void;
    setCustomer: (customer: CartCustomer | null) => void;
    /** The table number as typed (ignored while a sale attempt is unconfirmed). */
    setTableNo: (text: string) => void;
    /**
     * Applies SC/PWD (checked by the sheet): `markedKeys` are the lines it
     * consumes in `items` mode. The discounts it can't be combined with (the
     * order discount; the marked lines' discounts, or every line's in
     * `headcount` mode) are removed; the sheet confirms that first.
     */
    applyScPwd: (scPwd: ScPwdRequest, markedKeys: readonly string[]) => void;
    /** Removes SC/PWD and every line mark. */
    removeScPwd: () => void;
    /** Empties the cart and drops the pending ULID (a fresh sale). */
    clear: () => void;
    /** Checkout starts: returns the pending sale ULID, generating it the first time. */
    beginCheckout: () => string;
    /** Replaces the typed payments (ignored while a sale attempt is unconfirmed). */
    setTender: (tender: TenderDraft) => void;
    setAwaitingConfirmation: (awaiting: boolean) => void;
    /** Shows a rejected sale's messages on its lines and asks the Sell screen to show the cart. */
    showServerErrors: (errors: ServerCartErrors) => void;
    /** A new attempt is being sent: the last attempt's messages no longer apply. */
    clearServerErrors: () => void;
    /** Replaces the product snapshots of matching lines with fresh menu rows (after a catalogue sync). */
    repriceProducts: (products: readonly CartProduct[]) => void;
    /** The sale was created (201): a new sale starts with a new ULID. */
    completeSale: () => void;
};

export type CartState = CartData & CartActions;

function emptyCart(): CartData {
    return {
        lines: [],
        orderDiscount: null,
        customer: null,
        tableNo: "",
        pendingUlid: null,
        tender: { cash: "", gcash: [] },
        lineErrors: {},
        orderDiscountError: null,
        customerError: null,
        tableError: null,
        scPwd: null,
        scPwdErrors: {},
        cartError: null,
        awaitingConfirmation: false,
        showCartRequest: 0,
    };
}

let nextLineNumber = 1;

function newLineKey(): string {
    const key = `line-${nextLineNumber}`;
    nextLineNumber += 1;
    return key;
}

function clampQty(qty: number): number {
    return Math.min(CART_LIMITS.maxQty, Math.max(1, Math.trunc(qty)));
}

function withoutError(
    errors: Record<string, string>,
    key: string,
): Record<string, string> {
    if (!(key in errors)) return errors;
    const next = { ...errors };
    delete next[key];
    return next;
}

/**
 * A cart store. The app has one pay-now cart (`useCartStore`); Dine-in Tables &
 * Tabs makes more with the same rules (a table's next round, a tab settlement),
 * handed to the shared cart hooks and components through `CartStoreProvider`.
 */
export function createCartStore() {
    return create<CartState>()((set, get) => ({
        ...emptyCart(),

        addProduct: (product) => {
            const state = get();
            if (state.awaitingConfirmation) return "locked";
            if (!product.is_available) return "unavailable";

            // As agreed in Q-023: an SC/PWD-marked line isn't topped up: a new tap may be for someone else (a new, unmarked line).
            const existing = state.lines.find(
                (line) =>
                    line.product.id === product.id &&
                    line.discount === null &&
                    line.notes === null &&
                    !line.scPwd,
            );
            if (existing) {
                if (existing.qty >= CART_LIMITS.maxQty) return "maxQty";
                set({
                    lines: state.lines.map((line) =>
                        line.key === existing.key
                            ? { ...line, qty: line.qty + 1 }
                            : line,
                    ),
                    lineErrors: withoutError(state.lineErrors, existing.key),
                    cartError: null,
                });
                return "incremented";
            }

            if (state.lines.length >= CART_LIMITS.maxLines) return "maxLines";
            set({
                lines: [
                    ...state.lines,
                    {
                        key: newLineKey(),
                        product,
                        qty: 1,
                        discount: null,
                        notes: null,
                        scPwd: false,
                    },
                ],
                cartError: null,
            });
            return "added";
        },

        setQty: (key, qty) => {
            const state = get();
            if (state.awaitingConfirmation) return;
            set({
                lines: state.lines.map((line) =>
                    line.key === key ? { ...line, qty: clampQty(qty) } : line,
                ),
                lineErrors: withoutError(state.lineErrors, key),
                cartError: null,
            });
        },

        updateLine: (key, changes) => {
            const state = get();
            if (state.awaitingConfirmation) return;
            const notes = changes.notes?.trim()
                ? changes.notes.trim().slice(0, CART_LIMITS.lineNotesMax)
                : null;
            set({
                lines: state.lines.map((line) =>
                    line.key === key
                        ? {
                              ...line,
                              qty: clampQty(changes.qty),
                              // No double discount: an SC/PWD line (any line of a shared meal) takes no line discount.
                              discount: lineDiscountAllowed(
                                  state.scPwd,
                                  line.scPwd,
                              )
                                  ? changes.discount
                                  : null,
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
                // An empty cart has no SC/PWD left to apply.
                ...(lines.length === 0
                    ? { scPwd: null, scPwdErrors: {} }
                    : null),
            });
        },

        setOrderDiscount: (discount) => {
            const state = get();
            if (state.awaitingConfirmation) return;
            // No double discount: an order with SC/PWD takes no order discount.
            if (state.scPwd && discount) return;
            set({
                orderDiscount: discount,
                orderDiscountError: null,
                cartError: null,
            });
        },

        applyScPwd: (scPwd, markedKeys) => {
            const state = get();
            if (state.awaitingConfirmation || state.lines.length === 0) return;
            const marked = new Set(scPwd.mode === "items" ? markedKeys : []);
            const conflicts = scPwdConflicts(
                state.lines,
                state.orderDiscount,
                scPwd.mode,
                marked,
            );
            const stripped = new Set(conflicts.lineKeys);
            set({
                scPwd: {
                    mode: scPwd.mode,
                    persons: scPwd.persons.map((person) => ({
                        type: person.type,
                        id_no: person.id_no,
                    })),
                    diners: scPwd.mode === "headcount" ? scPwd.diners : null,
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
                lines: state.lines.map((line) =>
                    line.scPwd ? { ...line, scPwd: false } : line,
                ),
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

        clear: () =>
            set((state) => ({
                ...emptyCart(),
                showCartRequest: state.showCartRequest,
            })),

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

        setAwaitingConfirmation: (awaiting) =>
            set({ awaitingConfirmation: awaiting }),

        clearServerErrors: () =>
            set({
                lineErrors: {},
                orderDiscountError: null,
                customerError: null,
                tableError: null,
                scPwdErrors: {},
                cartError: null,
            }),

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
                    showCartRequest: state.showCartRequest + 1,
                };
            }),

        repriceProducts: (products) =>
            set((state) => {
                const byId = new Map(
                    products.map((product) => [product.id, product]),
                );
                return {
                    lines: state.lines.map((line) => {
                        const fresh = byId.get(line.product.id);
                        return fresh ? { ...line, product: fresh } : line;
                    }),
                };
            }),

        completeSale: () =>
            set((state) => ({
                ...emptyCart(),
                showCartRequest: state.showCartRequest,
            })),
    }));
}

export type CartStore = ReturnType<typeof createCartStore>;

/** The pay-now cart (Sell → Pay now, checkout, offline sales). */
export const useCartStore: CartStore = createCartStore();

const CartStoreContext = createContext<CartStore>(useCartStore);

/** Hands another cart store (a tab's round, a tab settlement) to the cart hooks below it. */
export const CartStoreProvider = CartStoreContext.Provider;

/** The cart store of this screen: the pay-now cart unless a `CartStoreProvider` gives another. */
export function useCartStoreApi(): CartStore {
    return useContext(CartStoreContext);
}

/** Test helper: back to an empty cart. */
export function resetCart(store: CartStore = useCartStore): void {
    store.setState(emptyCart());
}
