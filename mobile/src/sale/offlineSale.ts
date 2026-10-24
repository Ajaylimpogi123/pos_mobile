/**
 * Saving a sale on the tablet (docs/api-contract.md → Offline Sales → Device
 * rules → "When a sale goes offline" and "Local write"):
 *
 * 1. The device must have registered at least once for this server and
 *    branch; otherwise `Connect once to set up offline sales.`
 * 2. One SQLite transaction takes the next daily sequence, writes the local
 *    order and its outbox row, and lowers the cached stock. The sale is
 *    complete when it commits.
 * 3. Then the screens refresh and the outbox worker is asked to send it (it
 *    does nothing while offline). Printing is the caller's next step
 *    (`printSale(order)`), exactly as after an online sale.
 *
 * The ULID is the caller's: after a timeout it is the one `POST /orders` was
 * sent with, so a sale the server did commit comes back as `duplicate`.
 */
import { prepareDatabase } from '@/db/database';
import { readCategoryNames } from '@/db/menuQueries';
import { offlineRepository, type OfflineRepository, type StockDemand } from '@/db/offlineRepository';
import { buildLocalOrder, buildOfflineOrder, isoSeconds, type LocalSaleInput } from '@/sale/localOrder';
import type { SalePricing } from '@pos/core/sale/pricing';
import type { AuthUser, OrderPaymentRequest, PrintableOrder, SaleDiscount, ScPwdRequest } from '@/services/types';
import type { CachedDevice } from '@/services/secureStorage';
import type { CartCustomer, CartLine } from '@/stores/cart';
import { useOfflineStore } from '@/stores/offline';
import { OFFLINE_SETUP_MESSAGE, offlineDevice } from '@/sync/deviceRegistration';
import { refreshOutboxCounts, requestOutboxSync } from '@/sync/outboxSync';
import { businessDateAt } from '@pos/core/businessDay';

/** Contract: what the cashier sees when a sale is saved on the tablet. */
export const OFFLINE_SAVED_MESSAGE = 'No connection — sale saved on this tablet.';

/** Contract: a discount that needs approval can't be given offline. */
export const OFFLINE_APPROVAL_MESSAGE = 'Needs a manager approval — connect to the internet.';

export const OFFLINE_STORAGE_MESSAGE = "The sale couldn't be saved on this tablet. Nothing was recorded: try again.";

export type OfflineSaleInput = {
  ulid: string;
  lines: readonly CartLine[];
  orderDiscount: SaleDiscount | null;
  customer: CartCustomer | null;
  tableNo: string | null;
  payments: OrderPaymentRequest[];
  pricing: SalePricing;
  /** The user signed in at sale time (the cashier; their branch gives the business day). */
  user: AuthUser;
  /** Shifts & Reporting (Phase 6): the tablet's open shift. */
  shiftUlid: string;
  /** Senior Citizen / PWD Discount: the cart's SC/PWD (it never needs approval, so it works offline), or `null`. */
  scPwd: ScPwdRequest | null;
  now: number;
};

export type OfflineSaleOutcome =
  | { ok: true; order: PrintableOrder; created: boolean }
  | { ok: false; reason: 'notRegistered' | 'storage'; message: string };

export type OfflineSaleDeps = {
  device: () => Promise<CachedDevice | null>;
  prepareDatabase: () => Promise<boolean>;
  repository: Pick<OfflineRepository, 'saveOfflineSale'>;
  categoryNames: (ids: readonly number[]) => Promise<Map<number, string>>;
  /** After the commit: counts, screens, and the outbox worker. */
  afterSave: () => void;
};

/** Units sold per `track_stock` product (summed over its lines, as the server does). */
export function stockDemand(lines: readonly CartLine[]): StockDemand[] {
  const demand = new Map<number, number>();
  for (const line of lines) {
    if (!line.product.track_stock) continue;
    demand.set(line.product.id, (demand.get(line.product.id) ?? 0) + line.qty);
  }
  return [...demand].map(([productId, qty]) => ({ product_id: productId, qty }));
}

/** Saves the sale on the tablet (see the module notes). Never rejects. */
export async function saveOfflineSale(input: OfflineSaleInput, deps: OfflineSaleDeps = appDeps()): Promise<OfflineSaleOutcome> {
  try {
    const device = await deps.device();
    if (!device) return { ok: false, reason: 'notRegistered', message: OFFLINE_SETUP_MESSAGE };
    if (!(await deps.prepareDatabase())) return { ok: false, reason: 'storage', message: OFFLINE_STORAGE_MESSAGE };

    const { branch } = input.user;
    const businessDate = businessDateAt(input.now, branch.timezone, branch.day_start_time);
    const placedAt = isoSeconds(input.now);
    const categoryNames = await deps.categoryNames(input.lines.map((line) => line.product.category_id));

    const saved = await deps.repository.saveOfflineSale(
      {
        ulid: input.ulid,
        deviceCode: device.code,
        businessDate,
        branchId: branch.id,
        cashierId: input.user.id,
        shiftUlid: input.shiftUlid,
        now: placedAt,
        stockDemand: stockDemand(input.lines),
      },
      (sequence) => {
        const sale: LocalSaleInput = {
          ulid: input.ulid,
          lines: input.lines,
          orderDiscount: input.orderDiscount,
          customer: input.customer,
          tableNo: input.tableNo,
          payments: input.payments,
          pricing: input.pricing,
          cashier: { id: input.user.id, name: input.user.name },
          placedAt,
          businessDate,
          deviceCode: device.code,
          sequence,
          categoryNames,
          shiftUlid: input.shiftUlid,
          scPwd: input.scPwd,
        };
        return { order: buildLocalOrder(sale), payload: buildOfflineOrder(sale) };
      },
    );
    deps.afterSave();
    return { ok: true, order: saved.record.order, created: saved.created };
  } catch {
    return { ok: false, reason: 'storage', message: OFFLINE_STORAGE_MESSAGE };
  }
}

function appDeps(): OfflineSaleDeps {
  return {
    device: offlineDevice,
    prepareDatabase,
    repository: offlineRepository,
    categoryNames: readCategoryNames,
    afterSave: () => {
      const store = useOfflineStore.getState();
      store.markLocalChanged();
      store.markStockChanged();
      void refreshOutboxCounts();
      // "Right after each offline sale": nothing is sent while the device is offline.
      void requestOutboxSync();
    },
  };
}
