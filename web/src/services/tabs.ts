/**
 * Dine-in Tables & Tabs (v1.26) §D: tabs (`sale.create`; online only). One
 * function per endpoint. Every mutation sends an `Idempotency-Key` (a ULID
 * made when the action starts and reused on every retry until a 2xx); when
 * the body has a `ulid`, the key is that `ulid`.
 */
import { api } from '@/services/api';
import type {
  DataEnvelope,
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
} from '@/services/types';

function tabPath(ulid: string): string {
  return `/api/v1/tabs/${encodeURIComponent(ulid)}`;
}

function keyed(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

/** 1. POST /api/v1/tabs → 201 `{ data: Tab }`. 409 when the table already has an open bill. */
export async function openTab(body: TabOpenRequest): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>('/api/v1/tabs', body, keyed(body.ulid));
  return response.data;
}

/** 2. GET /api/v1/tabs/{ulid}. */
export async function getTab(ulid: string): Promise<Tab> {
  const response = await api.get<DataEnvelope<Tab>>(tabPath(ulid));
  return response.data;
}

/** 3. PATCH /api/v1/tabs/{ulid}: `guests`, `customer_id`, `notes` (partial). */
export async function updateTab(ulid: string, body: TabUpdateRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.patch<DataEnvelope<Tab>>(tabPath(ulid), body, keyed(idempotencyKey));
  return response.data;
}

/** 4. POST /api/v1/tabs/{ulid}/rounds → 200 `{ data: Tab, round_no }`. */
export async function sendTabRound(ulid: string, body: TabRoundRequest): Promise<TabRoundResponse> {
  return api.post<TabRoundResponse>(`${tabPath(ulid)}/rounds`, body, keyed(body.ulid));
}

/** 5. POST /api/v1/tabs/{ulid}/items/{id}/cancel → 200 `{ data: Tab }`. `idempotencyKey`: made when the dialog opens. */
export async function cancelTabItem(ulid: string, itemId: number, body: TabItemCancelRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/items/${itemId}/cancel`, body, keyed(idempotencyKey));
  return response.data;
}

/** 6. POST /api/v1/tabs/{ulid}/settle → 201 `{ data: Order, tab: Tab }`. */
export async function settleTab(ulid: string, body: TabSettleRequest): Promise<TabSettleResponse> {
  return api.post<TabSettleResponse>(`${tabPath(ulid)}/settle`, body, keyed(body.ulid));
}

/** 7. POST /api/v1/tabs/{ulid}/close → 200 `{ data: Tab }`. 409 while quantity remains. */
export async function closeTab(ulid: string, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/close`, undefined, keyed(idempotencyKey));
  return response.data;
}

/** 8. POST /api/v1/tabs/{ulid}/transfer (T2) → 200 `{ data: Tab }`. 409 when the target is occupied. */
export async function transferTab(ulid: string, body: TabTransferRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/transfer`, body, keyed(idempotencyKey));
  return response.data;
}

/** 9. POST /api/v1/tabs/{ulid}/merge (T2) → 200 `{ data: Tab }` (the target). */
export async function mergeTab(ulid: string, body: TabMergeRequest, idempotencyKey: string): Promise<Tab> {
  const response = await api.post<DataEnvelope<Tab>>(`${tabPath(ulid)}/merge`, body, keyed(idempotencyKey));
  return response.data;
}
