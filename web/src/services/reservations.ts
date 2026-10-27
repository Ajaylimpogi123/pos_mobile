/**
 * Table Management (v1.29) §E: reservations (`sale.create`; online only). One
 * function per endpoint. Every endpoint returns `409 "Dine-in tables are
 * turned off in Settings."` while dine-in is off. Every mutation sends an
 * `Idempotency-Key` (a ULID made when the action starts, reused on every retry
 * until a 2xx); on create, the key is the body's `ulid`.
 *
 * Seating goes through `POST /tabs` with `reservation_ulid` (`services/tabs.ts`).
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  Reservation,
  ReservationCancelRequest,
  ReservationCreateRequest,
  ReservationListParams,
  ReservationUpdateRequest,
} from '@/services/types';

const RESERVATIONS = '/api/v1/reservations';

function reservationPath(ulid: string): string {
  return `${RESERVATIONS}/${encodeURIComponent(ulid)}`;
}

function keyed(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

/** 1. GET /api/v1/reservations: one business day (default today), by `reserved_for`, then `id`. */
export async function listReservations(params: ReservationListParams = {}): Promise<CursorPage<Reservation>> {
  const query = buildQuery({
    date: params.date,
    status: params.status,
    table_id: params.table_id,
    per_page: params.per_page,
    cursor: params.cursor,
  });
  return api.get<CursorPage<Reservation>>(`${RESERVATIONS}${query}`);
}

/** 2. POST /api/v1/reservations → 201 `{ data: Reservation }`. `422` on `reserved_for` for a clash or a time out of range. */
export async function createReservation(body: ReservationCreateRequest): Promise<Reservation> {
  const response = await api.post<DataEnvelope<Reservation>>(RESERVATIONS, body, keyed(body.ulid));
  return response.data;
}

/** 3. PATCH /api/v1/reservations/{ulid}: partial; only while `booked` (`409` otherwise). */
export async function updateReservation(ulid: string, body: ReservationUpdateRequest, idempotencyKey: string): Promise<Reservation> {
  const response = await api.patch<DataEnvelope<Reservation>>(reservationPath(ulid), body, keyed(idempotencyKey));
  return response.data;
}

/** 4. POST /api/v1/reservations/{ulid}/cancel: only while `booked`. */
export async function cancelReservation(ulid: string, body: ReservationCancelRequest, idempotencyKey: string): Promise<Reservation> {
  const response = await api.post<DataEnvelope<Reservation>>(`${reservationPath(ulid)}/cancel`, body, keyed(idempotencyKey));
  return response.data;
}

/** 5. POST /api/v1/reservations/{ulid}/no-show: only while `booked`, and once `now ≥ reserved_for` (`409` earlier). */
export async function markReservationNoShow(ulid: string, idempotencyKey: string): Promise<Reservation> {
  const response = await api.post<DataEnvelope<Reservation>>(`${reservationPath(ulid)}/no-show`, undefined, keyed(idempotencyKey));
  return response.data;
}
