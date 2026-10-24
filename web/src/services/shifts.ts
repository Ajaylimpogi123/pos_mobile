/**
 * Shifts & Reporting (Phase 6): the shift endpoints, one function each. The
 * writes are idempotent by the body's (or the path's) `ulid` (no
 * `Idempotency-Key` header, Q-016); the token must be bound to a device, else
 * `409 "Register this tablet first."`. A cash movement or close for another
 * device's shift is `409 "This shift belongs to another tablet."`.
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

function shiftPath(ulid: string): string {
  return `/api/v1/shifts/${encodeURIComponent(ulid)}`;
}

/** POST /api/v1/shifts (`shift.open`) → 201 `{ data: Shift }` (a repeat returns 200). */
export async function openShift(body: ShiftOpenRequest): Promise<Shift> {
  const response = await api.post<DataEnvelope<Shift>>('/api/v1/shifts', body);
  return response.data;
}

/** GET /api/v1/shifts/{ulid}: `report.zread`, or any user for a shift of their own terminal. */
export async function getShift(ulid: string): Promise<Shift> {
  const response = await api.get<DataEnvelope<Shift>>(shiftPath(ulid));
  return response.data;
}

/**
 * GET /api/v1/shifts/current (any user; Q-035) → `{ data: Shift | null }`: the open
 * shift of the token's device. `409 "Register this tablet first."` when unbound.
 */
export async function getCurrentShift(): Promise<Shift | null> {
  const response = await api.get<DataEnvelope<Shift | null>>('/api/v1/shifts/current');
  return response.data;
}

/** POST /api/v1/shifts/{ulid}/cash-movements (`shift.open`) → 201 `{ data: CashMovement }`. */
export async function recordCashMovement(shiftUlid: string, body: CashMovementRequest): Promise<CashMovement> {
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
    `/api/v1/shifts${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      business_date: params.business_date,
      device_id: params.device_id,
      status: params.status,
    })}`,
  );
}
