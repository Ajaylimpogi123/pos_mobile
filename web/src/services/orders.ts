/**
 * Core Sale: orders. One function per endpoint.
 * - `createOrder` is idempotent: `Idempotency-Key` always equals the body's
 *   `ulid` (made when checkout opens, reused on every retry until a 201).
 * - Reading needs `sale.create` or `report.view`; without `report.view` the
 *   server shows only the caller's own orders.
 * - Voids & Refunds (Phase 7): `voidOrder` sends the void dialog's
 *   `Idempotency-Key`; `refundOrder` sends the refund's `ulid` as the key.
 * - Offline Sales (Phase 5): `reviewOrder` (`order.review`).
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  Order,
  OrderCreateRequest,
  OrderListParams,
  OrderReviewRequest,
  OrderSummary,
  RefundCreateRequest,
  VoidOrderRequest,
} from '@/services/types';

function orderPath(ulid: string): string {
  return `/api/v1/orders/${encodeURIComponent(ulid)}`;
}

/** POST /api/v1/orders → 201 `{ data: Order }`. */
export async function createOrder(body: OrderCreateRequest): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>('/api/v1/orders', body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}

/** GET /api/v1/orders: newest first. */
export async function listOrders(params: OrderListParams = {}): Promise<CursorPage<OrderSummary>> {
  return api.get<CursorPage<OrderSummary>>(
    `/api/v1/orders${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      business_date: params.business_date,
      search: params.search,
      status: params.status,
      // Sent as `1` only when filtering (a `0` would mean "not flagged").
      needs_review: params.needs_review ? true : undefined,
    })}`,
  );
}

/** GET /api/v1/orders/{ulid}. An order that isn't visible is a 404. */
export async function getOrder(ulid: string): Promise<Order> {
  const response = await api.get<DataEnvelope<Order>>(orderPath(ulid));
  return response.data;
}

/** POST /api/v1/orders/{ulid}/void → 200 `{ data: Order }`. `idempotencyKey`: made when the dialog opens, kept until a 200. */
export async function voidOrder(ulid: string, body: VoidOrderRequest, idempotencyKey: string): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(`${orderPath(ulid)}/void`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data;
}

/** POST /api/v1/orders/{ulid}/refunds → 201 `{ data: Order }` (its `refunds` include the new one). */
export async function refundOrder(ulid: string, body: RefundCreateRequest): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(`${orderPath(ulid)}/refunds`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}

/** POST /api/v1/orders/{ulid}/review (`order.review`) → 200 `{ data: Order }`. 409 when it doesn't need review. */
export async function reviewOrder(ulid: string, body: OrderReviewRequest): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(`${orderPath(ulid)}/review`, body);
  return response.data;
}
