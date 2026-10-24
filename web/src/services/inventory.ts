/**
 * Product inventory (Inventory (v1 completion); reads with `inventory.adjust`
 * or `report.view`, writes with `inventory.adjust`), plus the Core Sale stock
 * adjustment it extends with `type`. One function per endpoint.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  InventoryItem,
  InventoryListParams,
  InventoryMovement,
  InventoryMovementListParams,
  InventoryPage,
  ReorderLevelRequest,
  StockAdjustmentRequest,
  StockMovement,
} from '@/services/types';

const INVENTORY = '/api/v1/inventory';

/** GET /api/v1/inventory: tracked products by name; `meta.summary` is branch-wide. */
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

/** GET /api/v1/inventory/{product}: 404 unknown, 409 not tracking stock. */
export async function getInventoryItem(productId: number): Promise<InventoryItem> {
  const response = await api.get<DataEnvelope<InventoryItem>>(`${INVENTORY}/${productId}`);
  return response.data;
}

/** GET /api/v1/inventory/{product}/movements: newest first, optional `type`. */
export async function listInventoryMovements(productId: number, params: InventoryMovementListParams = {}): Promise<CursorPage<InventoryMovement>> {
  return api.get<CursorPage<InventoryMovement>>(
    `${INVENTORY}/${productId}/movements${buildQuery({ per_page: params.per_page, cursor: params.cursor, type: params.type })}`,
  );
}

/** PUT /api/v1/inventory/{product}/reorder-level: `null` turns the alert off. */
export async function setReorderLevel(productId: number, body: ReorderLevelRequest): Promise<InventoryItem> {
  const response = await api.put<DataEnvelope<InventoryItem>>(`${INVENTORY}/${productId}/reorder-level`, body);
  return response.data;
}

/** POST /api/v1/admin/products/{id}/stock-adjustments → 201. Idempotent: `Idempotency-Key` = `ulid`. */
export async function createStockAdjustment(productId: number, body: StockAdjustmentRequest): Promise<StockMovement> {
  const response = await api.post<DataEnvelope<StockMovement>>(`/api/v1/admin/products/${productId}/stock-adjustments`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}
