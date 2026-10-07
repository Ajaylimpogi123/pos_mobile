/**
 * Feature: Inventory (v1 completion). One function per contract endpoint,
 * through the shared client (`@/services/api`).
 * - Read (list, history): `inventory.adjust` or `report.view`.
 * - Write (reorder level): `inventory.adjust`. Stock in, count and wastage go
 *   through `createStockAdjustment` (`@/services/adminCatalog`) with a `type`.
 * The inventory report and its CSV live in `@/services/reports`.
 */
import { api, buildQuery } from '@/services/api';
import type {
  DataEnvelope,
  InventoryItem,
  InventoryListParams,
  InventoryMovement,
  InventoryMovementListParams,
  InventoryPage,
  CursorPage,
  ReorderLevelRequest,
} from '@/services/types';

const INVENTORY = '/api/v1/inventory';

/** The contract's hard maximum page size. */
export const INVENTORY_MAX_PAGE_SIZE = 100;

/**
 * GET /api/v1/inventory: the branch's non-deleted `track_stock` products
 * (unavailable ones included), by name. `meta.summary` counts the whole branch.
 */
export async function listInventory(params: InventoryListParams = {}): Promise<InventoryPage> {
  return api.get<InventoryPage>(
    `${INVENTORY}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      search: params.search,
      category_id: params.category_id,
      status: params.status,
    })}`,
  );
}

/** GET /api/v1/inventory/{product}/movements: newest first; `qty_after` is the running balance. */
export async function listInventoryMovements(
  productId: number,
  params: InventoryMovementListParams = {},
): Promise<CursorPage<InventoryMovement>> {
  return api.get<CursorPage<InventoryMovement>>(
    `${INVENTORY}/${productId}/movements${buildQuery({ per_page: params.per_page, cursor: params.cursor, type: params.type })}`,
  );
}

/** PUT /api/v1/inventory/{product}/reorder-level → 200 `{ data: InventoryItem }`. 409 when the product doesn't track stock. */
export async function setReorderLevel(productId: number, body: ReorderLevelRequest): Promise<InventoryItem> {
  const response = await api.put<DataEnvelope<InventoryItem>>(`${INVENTORY}/${productId}/reorder-level`, body);
  return response.data;
}

/**
 * GET /api/v1/inventory/{product} → 200 `{ data: InventoryItem }` (Q-020).
 * 404 when the product doesn't exist or is deleted; 409 `This product doesn't
 * track stock.` when it isn't `track_stock` (its history still reads).
 */
export async function getInventoryItem(productId: number): Promise<InventoryItem> {
  const response = await api.get<DataEnvelope<InventoryItem>>(`${INVENTORY}/${productId}`);
  return response.data;
}
