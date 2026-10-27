/**
 * Dine-in Tables & Tabs (v1.26) §B and §C: the branch's dining tables.
 * - Admin (`settings.manage`): list, create, update, delete. They work while
 *   dine-in is off, so tables can be set up first.
 * - `listTables` (`sale.create` or `report.view`): the active tables with
 *   their open tab summary; `409` while dine-in is off.
 * Table Management (v1.29): `saveTableLayout` (§B, one area's floor plan) and
 * `getTablesSummary` (§D, the status board; `report.view`).
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  DiningTable,
  DiningTableCreateRequest,
  DiningTableListParams,
  DiningTableUpdateRequest,
  TableLayoutRequest,
  TableLayoutResponse,
  TablesSummary,
  TableView,
  TableViewListParams,
} from '@/services/types';

const ADMIN_TABLES = '/api/v1/admin/tables';

/** GET /api/v1/admin/tables: by `area`, `sort_order`, `name` (`per_page` 1–100, default 100). */
export async function listAdminTables(params: DiningTableListParams = {}): Promise<CursorPage<DiningTable>> {
  return api.get<CursorPage<DiningTable>>(`${ADMIN_TABLES}${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/** POST /api/v1/admin/tables → 201 `{ data: DiningTable }`. */
export async function createTable(body: DiningTableCreateRequest): Promise<DiningTable> {
  const response = await api.post<DataEnvelope<DiningTable>>(ADMIN_TABLES, body);
  return response.data;
}

/** PATCH /api/v1/admin/tables/{id}: partial. 409 when deactivating a table with an open bill. */
export async function updateTable(id: number, body: DiningTableUpdateRequest): Promise<DiningTable> {
  const response = await api.patch<DataEnvelope<DiningTable>>(`${ADMIN_TABLES}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/tables/{id} → 204 (soft delete). 409 with an open bill. */
export async function deleteTable(id: number): Promise<void> {
  await api.delete<void>(`${ADMIN_TABLES}/${id}`);
}

/** GET /api/v1/tables: the active tables, each with its open tab (`null` = free). */
export async function listTables(params: TableViewListParams = {}): Promise<CursorPage<TableView>> {
  return api.get<CursorPage<TableView>>(`/api/v1/tables${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/**
 * PUT /api/v1/admin/tables/layout (Table Management §B): one area's plan,
 * saved atomically → 200 `{ data: DiningTable[] }` (the area's tables).
 * `422` on `tables.{i}.id` / `tables.{i}.pos_x` for a table outside the area,
 * off the grid or overlapping another.
 */
export async function saveTableLayout(body: TableLayoutRequest): Promise<DiningTable[]> {
  const response = await api.put<TableLayoutResponse>(`${ADMIN_TABLES}/layout`, body);
  return response.data;
}

/** GET /api/v1/tables/summary (Table Management §D; `report.view`; `409` while dine-in is off). */
export async function getTablesSummary(): Promise<TablesSummary> {
  const response = await api.get<DataEnvelope<TablesSummary>>('/api/v1/tables/summary');
  return response.data;
}
