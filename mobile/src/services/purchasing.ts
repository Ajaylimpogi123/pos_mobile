/**
 * Feature: Ingredients, Recipes & Purchasing §F–§H: purchase requests,
 * purchase orders and receiving. One function per contract endpoint, through
 * the shared client (`@/services/api`). Reads need any purchase permission
 * or `report.view`; each write names its own permission.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  GoodsReceiptRequest,
  PurchaseDecisionRequest,
  PurchaseOrder,
  PurchaseOrderDeclineRequest,
  PurchaseOrderListParams,
  PurchaseOrderUpdateRequest,
  PurchaseRequest,
  PurchaseRequestCreateRequest,
  PurchaseRequestListParams,
  PurchaseRequestUpdateRequest,
} from '@/services/types';

const REQUESTS = '/api/v1/purchase-requests';
const ORDERS = '/api/v1/purchase-orders';

// ---------------------------------------------------------------------------
// Purchase requests
// ---------------------------------------------------------------------------

/** GET /api/v1/purchase-requests: newest first; `mine` / `needs_decision` are sent only when true. */
export async function listPurchaseRequests(params: PurchaseRequestListParams = {}): Promise<CursorPage<PurchaseRequest>> {
  return api.get<CursorPage<PurchaseRequest>>(
    `${REQUESTS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      status: params.status,
      supplier_id: params.supplier_id,
      search: params.search,
      mine: params.mine ? true : undefined,
      needs_decision: params.needs_decision ? true : undefined,
    })}`,
  );
}

/** POST /api/v1/purchase-requests → 201 (`purchase.request`). Idempotent: `Idempotency-Key` = `body.ulid`. */
export async function createPurchaseRequest(body: PurchaseRequestCreateRequest): Promise<PurchaseRequest> {
  const response = await api.post<DataEnvelope<PurchaseRequest>>(REQUESTS, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}

/** GET /api/v1/purchase-requests/{ulid}: the PR plus `timeline[]`. */
export async function getPurchaseRequest(ulid: string): Promise<PurchaseRequest> {
  const response = await api.get<DataEnvelope<PurchaseRequest>>(`${REQUESTS}/${ulid}`);
  return response.data;
}

/** PATCH /api/v1/purchase-requests/{ulid}: only while no item is decided (else 409 `This request is already being reviewed.`). */
export async function updatePurchaseRequest(ulid: string, body: PurchaseRequestUpdateRequest): Promise<PurchaseRequest> {
  const response = await api.patch<DataEnvelope<PurchaseRequest>>(`${REQUESTS}/${ulid}`, body);
  return response.data;
}

/** DELETE /api/v1/purchase-requests/{ulid}: a soft cancel (`status = cancelled`), same condition as PATCH. */
export async function cancelPurchaseRequest(ulid: string): Promise<void> {
  await api.delete<void>(`${REQUESTS}/${ulid}`);
}

/**
 * POST /api/v1/purchase-requests/{ulid}/decisions → 200 with the PR
 * (`purchase.approve`; deciding your own PR needs `purchase.approve_own`, else
 * 403 `Someone else must approve your own request.`).
 */
export async function decidePurchaseRequest(ulid: string, body: PurchaseDecisionRequest): Promise<PurchaseRequest> {
  const response = await api.post<DataEnvelope<PurchaseRequest>>(`${REQUESTS}/${ulid}/decisions`, body);
  return response.data;
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

/** GET /api/v1/purchase-orders: `to_receive` = approved and not fully received (sent only when true). */
export async function listPurchaseOrders(params: PurchaseOrderListParams = {}): Promise<CursorPage<PurchaseOrder>> {
  return api.get<CursorPage<PurchaseOrder>>(
    `${ORDERS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      status: params.status,
      receiving_status: params.receiving_status,
      supplier_id: params.supplier_id,
      search: params.search,
      to_receive: params.to_receive ? true : undefined,
    })}`,
  );
}

/** GET /api/v1/purchase-orders/{ulid}. */
export async function getPurchaseOrder(ulid: string): Promise<PurchaseOrder> {
  const response = await api.get<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}`);
  return response.data;
}

/** PATCH /api/v1/purchase-orders/{ulid} (`pending_approval` only; else 409 `An approved order can't be edited.`). */
export async function updatePurchaseOrder(ulid: string, body: PurchaseOrderUpdateRequest): Promise<PurchaseOrder> {
  const response = await api.patch<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}`, body);
  return response.data;
}

/**
 * POST /api/v1/purchase-orders/{ulid}/approve (`purchase.approve` + the
 * self-approval rule). 422 `Set a price for every line before approving.`
 */
export async function approvePurchaseOrder(ulid: string): Promise<PurchaseOrder> {
  const response = await api.post<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}/approve`);
  return response.data;
}

/** POST /api/v1/purchase-orders/{ulid}/decline `{ reason }`. */
export async function declinePurchaseOrder(ulid: string, body: PurchaseOrderDeclineRequest): Promise<PurchaseOrder> {
  const response = await api.post<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}/decline`, body);
  return response.data;
}

/**
 * POST /api/v1/purchase-orders/{ulid}/receipts → 201 with the PO
 * (`purchase.receive`). Idempotent: `Idempotency-Key` = `body.ulid`.
 */
export async function createGoodsReceipt(poUlid: string, body: GoodsReceiptRequest): Promise<PurchaseOrder> {
  const response = await api.post<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${poUlid}/receipts`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}
