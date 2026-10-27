/**
 * Feature: Table Management (v1.29) §E: reservations (TM2; `sale.create`;
 * online only). One function per contract endpoint.
 * - While dine-in is off every one answers `409 "Dine-in tables are turned off in Settings."`
 * - Every mutation takes an `Idempotency-Key`: the body's `ulid` on create,
 *   otherwise a ULID made when the action starts.
 * - `GET` needs `sale.create` or `report.view` (Q-051); every mutation needs `sale.create`.
 * - Update, cancel and no-show return `200 {data: Reservation}` (Q-052); the app reloads the lists after each.
 * - Seating goes through `POST /api/v1/tabs` with `reservation_ulid` (`openTab` in `@/services/tables`).
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

function idempotent(key: string) {
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

/** 2. POST /api/v1/reservations → 201. `Idempotency-Key` = `body.ulid`. */
export async function createReservation(body: ReservationCreateRequest): Promise<Reservation> {
  const response = await api.post<DataEnvelope<Reservation>>(RESERVATIONS, body, idempotent(body.ulid));
  return response.data;
}

/** 3. PATCH /api/v1/reservations/{ulid}: partial; only while `booked` (else `409`). 200 `{data: Reservation}`. */
export async function updateReservation(ulid: string, body: ReservationUpdateRequest, idempotencyKey: string): Promise<Reservation> {
  const response = await api.patch<DataEnvelope<Reservation>>(reservationPath(ulid), body, idempotent(idempotencyKey));
  return response.data;
}

/** 4. POST /api/v1/reservations/{ulid}/cancel: only while `booked`. 200 `{data: Reservation}`. */
export async function cancelReservation(ulid: string, body: ReservationCancelRequest, idempotencyKey: string): Promise<Reservation> {
  const response = await api.post<DataEnvelope<Reservation>>(`${reservationPath(ulid)}/cancel`, body, idempotent(idempotencyKey));
  return response.data;
}

/** 5. POST /api/v1/reservations/{ulid}/no-show: only while `booked`, and once `now ≥ reserved_for`. 200 `{data: Reservation}`. */
export async function markReservationNoShow(ulid: string, idempotencyKey: string): Promise<Reservation> {
  const response = await api.post<DataEnvelope<Reservation>>(`${reservationPath(ulid)}/no-show`, undefined, idempotent(idempotencyKey));
  return response.data;
}
