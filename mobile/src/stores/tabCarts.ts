import { create } from 'zustand';

import type { TenderDraft } from '@pos/core/sale/payments';

import { createCartStore, type CartStore } from './cart';

/**
 * Dine-in Tables & Tabs: the carts of the tab screens, in memory only (the
 * cart stays client-only, PROJECT_MEMORY decision #5).
 *
 * - **A round** per open tab: the items being added before **Send to
 *   kitchen**, with the cart's rules (100 lines, qty 1–999, notes). Its
 *   `pendingUlid` is the round's ULID (and `Idempotency-Key`), kept until a
 *   `200`; `awaitingConfirmation` locks it after a send that got no answer.
 *   Each table keeps its own draft round while staff move between tables.
 * - **The settlement** being paid: the tab's remaining lines as cart lines
 *   (key `tab-<tab_item_id>`, the snapshot price), so the shared cart hooks
 *   give it line and order discounts and SC/PWD; `pendingUlid` is the
 *   settlement's ULID. One at a time.
 */
const rounds = new Map<string, CartStore>();

/** The draft round of a tab (made on first use). */
export function roundCartFor(tabUlid: string): CartStore {
  let store = rounds.get(tabUlid);
  if (!store) {
    store = createCartStore();
    rounds.set(tabUlid, store);
  }
  return store;
}

/** The tab is closed, merged or gone: its draft round is dropped. */
export function dropRoundCart(tabUlid: string): void {
  rounds.delete(tabUlid);
}

/** The settlement cart (one at a time). */
export const tabSettlementCart: CartStore = createCartStore();

/** The tab-item id of a settlement line (`tab-41` → 41). */
export function tabItemIdOfLine(key: string): number | null {
  const match = /^tab-(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

export type TabPayMode = 'whole' | 'items' | 'equal';

type TabCheckoutData = {
  /** The tab this checkout is for (`null`: none started). */
  tabUlid: string | null;
  mode: TabPayMode;
  /** By item: the quantity to pay now per tab item id. */
  selected: Record<number, number>;
  /** The service-charge toggle (`service_charge`). */
  serviceCharge: boolean;
  /** Equally: 2–10 shares. */
  splitCount: number;
  /** The payment of each share, in share order (equal split). */
  shareTenders: TenderDraft[];
  /** The share being paid (0-based). */
  shareIndex: number;
};

type TabCheckoutActions = {
  start: (tabUlid: string, mode: TabPayMode) => void;
  set: (changes: Partial<Omit<TabCheckoutData, 'tabUlid'>>) => void;
  reset: () => void;
};

const EMPTY: TabCheckoutData = {
  tabUlid: null,
  mode: 'whole',
  selected: {},
  serviceCharge: true,
  splitCount: 2,
  shareTenders: [],
  shareIndex: 0,
};

/** What the tab's Pay screen chose (above every layout switch, so rotating or leaving keeps it). */
export const useTabCheckoutStore = create<TabCheckoutData & TabCheckoutActions>()((set) => ({
  ...EMPTY,
  start: (tabUlid, mode) => set({ ...EMPTY, tabUlid, mode }),
  set: (changes) => set(changes),
  reset: () => set(EMPTY),
}));
