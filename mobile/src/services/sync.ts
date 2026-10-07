/**
 * The sync endpoints, through the shared client (`@/services/api`): its 401
 * handling (sign out) and typed errors (`ApiValidationError` for 422) apply
 * as everywhere else.
 * - Catalogue Sync (Phase 2): the run loop and the SQLite apply logic live in `@/sync/catalogueSync`.
 * - Offline Sales (Phase 5): the outbox worker (`@/sync/outboxSync`) and the
 *   advisory stock cache (`@/sync/stockSync`).
 */
import { api, buildQuery } from '@/services/api';
import type {
  CatalogueSyncParams,
  CatalogueSyncResponse,
  DataEnvelope,
  StockSnapshot,
  SyncOrderResult,
  SyncOrdersRequest,
} from '@/services/types';

/** POST /sync/orders waits up to 30 s: a batch of 50 on a slow server shouldn't time out. */
export const SYNC_ORDERS_TIMEOUT_MS = 30_000;

/** GET /api/v1/sync/catalogue: a baseline page (no `cursor`) or a delta page. */
export async function getCatalogueChanges(params: CatalogueSyncParams = {}): Promise<CatalogueSyncResponse> {
  return api.get<CatalogueSyncResponse>(
    `/api/v1/sync/catalogue${buildQuery({ cursor: params.cursor, limit: params.limit })}`,
  );
}

/**
 * POST /api/v1/sync/orders (`sale.create`; the token must be bound to a
 * device, else `409 "Register this tablet first."`). Idempotent by each
 * order's `ulid`, so there is no `Idempotency-Key` header. Returns one result
 * per submitted order, in the same order.
 */
export async function syncOrders(body: SyncOrdersRequest): Promise<SyncOrderResult[]> {
  const response = await api.post<DataEnvelope<SyncOrderResult[]>>('/api/v1/sync/orders', body, {
    timeoutMs: SYNC_ORDERS_TIMEOUT_MS,
  });
  return response.data;
}

/** GET /api/v1/sync/stock: the advisory stock levels of the caller's branch (not paginated). */
export async function getStockLevels(): Promise<StockSnapshot> {
  const response = await api.get<DataEnvelope<StockSnapshot>>('/api/v1/sync/stock');
  return response.data;
}
