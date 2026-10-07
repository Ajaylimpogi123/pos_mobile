/**
 * Feature: Shifts & Reporting (Phase 6): shift endpoints. One function per
 * contract endpoint, through the shared client (`@/services/api`).
 *
 * - The three writes are **idempotent by the `ulid`** in the body or the path
 *   (a repeat gets the stored result with 200), so there is no
 *   `Idempotency-Key` header (like `POST /sync/orders`; see Q-016). The token
 *   must be bound to a device, else `409 "Register this tablet first."`.
 * - The app never calls the writes from a screen: shift events always go
 *   through the outbox (`@/sync/outboxSync`), online or offline.
 * - Reading the list needs `report.zread`; one shift needs `report.zread`, or
 *   is a shift of the caller's own tablet.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CashMovement,
  CashMovementRequest,
  CursorPage,
  DataEnvelope,
  Shift,
  ShiftCloseRequest,
  ShiftListParams,
  ShiftOpenRequest,
} from '@/services/types';

const SHIFTS = '/api/v1/shifts';

function shiftPath(ulid: string): string {
  return `${SHIFTS}/${encodeURIComponent(ulid)}`;
}

/** POST /api/v1/shifts (`shift.open`) → 201 `{ data: Shift }` (a repeat returns 200). */
export async function openShift(body: ShiftOpenRequest): Promise<Shift> {
  const response = await api.post<DataEnvelope<Shift>>(SHIFTS, body);
  return response.data;
}

/** POST /api/v1/shifts/{ulid}/cash-movements (`shift.open`) → 201 `{ data: CashMovement }`. */
export async function createCashMovement(shiftUlid: string, body: CashMovementRequest): Promise<CashMovement> {
  const response = await api.post<DataEnvelope<CashMovement>>(`${shiftPath(shiftUlid)}/cash-movements`, body);
  return response.data;
}

/** POST /api/v1/shifts/{ulid}/close (`shift.close`) → 200 `{ data: Shift }`. The first close wins. */
export async function closeShift(shiftUlid: string, body: ShiftCloseRequest): Promise<Shift> {
  const response = await api.post<DataEnvelope<Shift>>(`${shiftPath(shiftUlid)}/close`, body);
  return response.data;
}

/** GET /api/v1/shifts (`report.zread`): cursor list, `opened_at` descending. */
export async function listShifts(params: ShiftListParams = {}): Promise<CursorPage<Shift>> {
  return api.get<CursorPage<Shift>>(
    `${SHIFTS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      business_date: params.business_date,
      device_id: params.device_id,
      status: params.status,
    })}`,
  );
}

/** GET /api/v1/shifts/{ulid} → 200 `{ data: Shift }` (the server's `ShiftReport` is the record of truth). */
export async function getShift(ulid: string): Promise<Shift> {
  const response = await api.get<DataEnvelope<Shift>>(shiftPath(ulid));
  return response.data;
}
