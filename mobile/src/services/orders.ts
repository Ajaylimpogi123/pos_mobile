/**
 * Feature: Core Sale (Phase 3): orders. One function per contract endpoint.
 * - Creating needs `sale.create` and is idempotent: the `Idempotency-Key`
 *   header always equals the body's `ulid`. A replay of a completed sale
 *   returns the stored `201` again, so retrying with the same ULID is safe.
 * - Reading needs `sale.create` or `report.view`; without `report.view` the
 *   server shows only the caller's own orders.
 * - Offline Sales (Phase 5): the list filters on `needs_review`, and
 *   `order.review` marks a flagged offline sale reviewed.
 * - Voids & Refunds (Phase 7): the list filters on `status`; `voidOrder`
 *   (the `Idempotency-Key` is a ULID the void dialog made, kept until a 200)
 *   and `refundOrder` (the `Idempotency-Key` is the body's `ulid`).
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

const ORDERS = '/api/v1/orders';

function orderPath(ulid: string): string {
  return `${ORDERS}/${encodeURIComponent(ulid)}`;
}

/**
 * POST /orders gives up after 8 s (Offline Sales hardening): a timeout falls back to an
 * offline save with the same ULID, which is safe, so the cashier never waits the full 15 s.
 */
export const CREATE_ORDER_TIMEOUT_MS = 8_000;

/** POST /api/v1/orders → 201 `{ data: Order }`. Idempotent: `Idempotency-Key` = `body.ulid`. */
export async function createOrder(body: OrderCreateRequest): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(ORDERS, body, {
    headers: { 'Idempotency-Key': body.ulid },
    timeoutMs: CREATE_ORDER_TIMEOUT_MS,
  });
  return response.data;
}

/** GET /api/v1/orders: newest first; filter by business date, cashier, invoice number, "needs review" or status. */
export async function listOrders(params: OrderListParams = {}): Promise<CursorPage<OrderSummary>> {
  return api.get<CursorPage<OrderSummary>>(
    `${ORDERS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      business_date: params.business_date,
      cashier_id: params.cashier_id,
      search: params.search,
      // Sent only to filter (as `1`): the app never asks for `needs_review=0`.
      needs_review: params.needs_review ? true : undefined,
      status: params.status,
    })}`,
  );
}

/** GET /api/v1/orders/{ulid}. An order that isn't visible to the caller is a 404. */
export async function getOrder(ulid: string): Promise<Order> {
  const response = await api.get<DataEnvelope<Order>>(orderPath(ulid));
  return response.data;
}

/**
 * POST /api/v1/orders/{ulid}/review (`order.review`): clears `needs_review` and
 * records who reviewed it (`review_reasons` is kept). 200 `{ data: Order }`;
 * `409` when the order doesn't need review; `404` when it isn't visible.
 */
export async function reviewOrder(ulid: string, body: OrderReviewRequest): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(`${orderPath(ulid)}/review`, body);
  return response.data;
}

/**
 * POST /api/v1/orders/{ulid}/void (`sale.create` or `sale.void`) → 200
 * `{ data: Order }` with `status: "voided"`. Idempotent: `idempotencyKey` is
 * the ULID the void dialog made when it opened; the caller reuses it on every
 * retry until a 200. `409` for the state and the window (e.g. `This sale's
 * shift is closed. Refund it instead.`), `422` for the reason or the approval,
 * `429` while the approver's PIN is locked.
 */
export async function voidOrder(ulid: string, body: VoidOrderRequest, idempotencyKey: string): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(`${orderPath(ulid)}/void`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data;
}

/**
 * POST /api/v1/orders/{ulid}/refunds (`sale.create` or `sale.refund`) → 201
 * `{ data: Order }`, whose `refunds` includes the new one. Idempotent:
 * `Idempotency-Key` = `body.ulid` (made when the refund screen opened, kept
 * until a 201).
 */
export async function refundOrder(ulid: string, body: RefundCreateRequest): Promise<Order> {
  const response = await api.post<DataEnvelope<Order>>(`${orderPath(ulid)}/refunds`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}
