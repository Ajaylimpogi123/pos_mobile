/**
 * Feature: Dine-in Tables & Tabs (v1.26). One function per contract endpoint.
 * - Admin tables (§B): `settings.manage`. They work while dine-in is off.
 * - Tables view (§C) and tabs (§D): `sale.create`, online only. While
 *   dine-in is off every one answers `409 "Dine-in tables are turned off in Settings."`
 * - Every tab mutation takes an `Idempotency-Key`: a ULID made when the
 *   action starts (the body's `ulid` where the body has one), and the server
 *   replays the same response for it.
 *
 * Table Management (v1.29): the floor plan layout (§B, `settings.manage`) and
 * the status board summary (§D, `report.view`). Reservations are in
 * `@/services/reservations`.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  DiningTable,
  DiningTableCreateRequest,
  DiningTableListParams,
  DiningTableUpdateRequest,
  Tab,
  TabItemCancelRequest,
  TabMergeRequest,
  TabOpenRequest,
  TabRoundRequest,
  TabRoundResponse,
  TabSettleRequest,
  TabSettleResponse,
  TabTransferRequest,
  TabUpdateRequest,
  TableLayoutRequest,
  TableLayoutResponse,
  TablesSummary,
  TableView,
  TableViewListParams,
} from '@/services/types';

const ADMIN_TABLES = '/api/v1/admin/tables';
const TABLES = '/api/v1/tables';
const TABS = '/api/v1/tabs';

function tabPath(ulid: string): string {
  return `${TABS}/${encodeURIComponent(ulid)}`;
}

function idempotent(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

// --- §B Admin tables ---------------------------------------------------------

/** GET /api/v1/admin/tables: by `area`, `sort_order`, `name`; inactive tables included. */
export async function listAdminTables(params: DiningTableListParams = {}): Promise<CursorPage<DiningTable>> {
  return api.get<CursorPage<DiningTable>>(`${ADMIN_TABLES}${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/** POST /api/v1/admin/tables → 201. */
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

/**
 * PUT /api/v1/admin/tables/layout (Table Management §B): one area's plan,
 * saved atomically → the area's tables in the admin order. `422` on
 * `tables.{i}.id` / `tables.{i}.pos_x` names the table.
 */
export async function saveTableLayout(body: TableLayoutRequest): Promise<DiningTable[]> {
  const response = await api.put<TableLayoutResponse>(`${ADMIN_TABLES}/layout`, body);
  return response.data;
}

// --- §C Tables view ------------------------------------------------------------

/** GET /api/v1/tables: the active tables in the admin order, each with its open tab (`null` = free). */
export async function listTables(params: TableViewListParams = {}): Promise<CursorPage<TableView>> {
  return api.get<CursorPage<TableView>>(`${TABLES}${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/** GET /api/v1/tables/summary (Table Management §D; `report.view`; `409` while dine-in is off). */
export async function getTablesSummary(): Promise<TablesSummary> {
  const response = await api.get<DataEnvelope<TablesSummary>>(`${TABLES}/summary`);
  return response.data;
}

// --- §D Tabs ---------------------------------------------------------------------

/** 1. POST /api/v1/tabs → 201. `Idempotency-Key` = `body.ulid`. */
export async function openTab(body: TabOpenRequest): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(TABS, body, idempotent(body.ulid));
  return response.data;
}

/** 2. GET /api/v1/tabs/{ulid}. */
export async function getTab(ulid: string): Promise<Tab> {
  const response = await api.get<DataEnvelope<Tab>>(tabPath(ulid));
  return response.data;
}

/** 3. PATCH /api/v1/tabs/{ulid}: guests, customer, notes (partial). */
export async function updateTab(ulid: string, body: TabUpdateRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.patch<DataEnvelope<Tab>>(tabPath(ulid), body, idempotent(idempotencyKey));
  return response.data;
}

/** 4. POST /api/v1/tabs/{ulid}/rounds → 200 `{data, round_no}`. `Idempotency-Key` = `body.ulid`. */
export async function sendRound(ulid: string, body: TabRoundRequest): Promise<TabRoundResponse> {
  return api.post<TabRoundResponse>(`${tabPath(ulid)}/rounds`, body, idempotent(body.ulid));
}

/** 5. POST /api/v1/tabs/{ulid}/items/{id}/cancel. */
export async function cancelTabItem(ulid: string, itemId: number, body: TabItemCancelRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/items/${itemId}/cancel`, body, idempotent(idempotencyKey));
  return response.data;
}

/** 6. POST /api/v1/tabs/{ulid}/settle → 201 `{data: Order, tab: Tab}`. `Idempotency-Key` = `body.ulid`. */
export async function settleTab(ulid: string, body: TabSettleRequest): Promise<TabSettleResponse> {
  return api.post<TabSettleResponse>(`${tabPath(ulid)}/settle`, body, idempotent(body.ulid));
}

/** 7. POST /api/v1/tabs/{ulid}/close: only when nothing remains. */
export async function closeTab(ulid: string, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/close`, undefined, idempotent(idempotencyKey));
  return response.data;
}

/** 8. POST /api/v1/tabs/{ulid}/transfer (T2): to an active, free table. */
export async function transferTab(ulid: string, body: TabTransferRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/transfer`, body, idempotent(idempotencyKey));
  return response.data;
}

/** 9. POST /api/v1/tabs/{ulid}/merge (T2) → the target tab. */
export async function mergeTab(ulid: string, body: TabMergeRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/merge`, body, idempotent(idempotencyKey));
  return response.data;
}
