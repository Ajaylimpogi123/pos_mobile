/**
 * Purchasing (Ingredients, Recipes & Purchasing §E–§H; Q-027, Q-030): purchase
 * requests, purchase orders and receipts. Reads need any purchase permission
 * or `report.view`; each write names its permission. The PR create and the
 * receipt are idempotent (`Idempotency-Key` = the body's `ulid`).
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

/** GET /api/v1/purchase-requests: newest first; `status`, `supplier_id`, `search`, `mine`, `needs_decision`. */
export async function listPurchaseRequests(params: PurchaseRequestListParams = {}): Promise<CursorPage<PurchaseRequest>> {
  return api.get<CursorPage<PurchaseRequest>>(
    `${REQUESTS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      status: params.status,
      supplier_id: params.supplier_id,
      search: params.search,
      mine: params.mine,
      needs_decision: params.needs_decision,
    })}`,
  );
}

/** POST /api/v1/purchase-requests (`purchase.request`) → 201. Idempotent. */
export async function createPurchaseRequest(body: PurchaseRequestCreateRequest): Promise<PurchaseRequest> {
  const response = await api.post<DataEnvelope<PurchaseRequest>>(REQUESTS, body, { headers: { 'Idempotency-Key': body.ulid } });
  return response.data;
}

/** GET /api/v1/purchase-requests/{ulid}: with `timeline`. */
export async function getPurchaseRequest(ulid: string): Promise<PurchaseRequest> {
  const response = await api.get<DataEnvelope<PurchaseRequest>>(`${REQUESTS}/${ulid}`);
  return response.data;
}

/** PATCH /api/v1/purchase-requests/{ulid}: while no item is decided (else 409). Items by `id`. */
export async function updatePurchaseRequest(ulid: string, body: PurchaseRequestUpdateRequest): Promise<PurchaseRequest> {
  const response = await api.patch<DataEnvelope<PurchaseRequest>>(`${REQUESTS}/${ulid}`, body);
  return response.data;
}

/** DELETE /api/v1/purchase-requests/{ulid} → 204: a soft cancel (`status = cancelled`). */
export async function cancelPurchaseRequest(ulid: string): Promise<void> {
  await api.delete<void>(`${REQUESTS}/${ulid}`);
}

/** POST /api/v1/purchase-requests/{ulid}/decisions (`purchase.approve` + self-approval) → the PR. */
export async function decidePurchaseRequest(ulid: string, body: PurchaseDecisionRequest): Promise<PurchaseRequest> {
  const response = await api.post<DataEnvelope<PurchaseRequest>>(`${REQUESTS}/${ulid}/decisions`, body);
  return response.data;
}

/** GET /api/v1/purchase-orders: `status`, `receiving_status`, `supplier_id`, `search`, `to_receive`. */
export async function listPurchaseOrders(params: PurchaseOrderListParams = {}): Promise<CursorPage<PurchaseOrder>> {
  return api.get<CursorPage<PurchaseOrder>>(
    `${ORDERS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      status: params.status,
      receiving_status: params.receiving_status,
      supplier_id: params.supplier_id,
      search: params.search,
      to_receive: params.to_receive,
    })}`,
  );
}

/** GET /api/v1/purchase-orders/{ulid}. */
export async function getPurchaseOrder(ulid: string): Promise<PurchaseOrder> {
  const response = await api.get<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}`);
  return response.data;
}

/** PATCH /api/v1/purchase-orders/{ulid}: `pending_approval` only (else 409). Lines by `id`. */
export async function updatePurchaseOrder(ulid: string, body: PurchaseOrderUpdateRequest): Promise<PurchaseOrder> {
  const response = await api.patch<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}`, body);
  return response.data;
}

/** POST /api/v1/purchase-orders/{ulid}/approve (`purchase.approve` + self-approval). */
export async function approvePurchaseOrder(ulid: string): Promise<PurchaseOrder> {
  const response = await api.post<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}/approve`);
  return response.data;
}

/** POST /api/v1/purchase-orders/{ulid}/decline: `{ reason }`. */
export async function declinePurchaseOrder(ulid: string, body: PurchaseOrderDeclineRequest): Promise<PurchaseOrder> {
  const response = await api.post<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${ulid}/decline`, body);
  return response.data;
}

/** POST /api/v1/purchase-orders/{ulid}/receipts (`purchase.receive`) → 201 with the PO. Idempotent. */
export async function createGoodsReceipt(poUlid: string, body: GoodsReceiptRequest): Promise<PurchaseOrder> {
  const response = await api.post<DataEnvelope<PurchaseOrder>>(`${ORDERS}/${poUlid}/receipts`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}
