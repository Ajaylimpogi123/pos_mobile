/**
 * Hardening & Pilot (Phase 8) §B: the error log. One function per contract
 * endpoint, through the shared client (`@/services/api`).
 */
import { api, buildQuery } from '@/services/api';
import type {
  ClientErrorsAccepted,
  ClientErrorsRequest,
  DataEnvelope,
  ErrorGroup,
  ErrorGroupDetail,
  ErrorLogListResponse,
  ErrorLogQuery,
} from '@/services/types';

/** The path of `POST /client-errors` (the 5xx reporter never reports its own failures). */
export const CLIENT_ERRORS_PATH = '/api/v1/client-errors';

/**
 * POST /api/v1/client-errors → 202 `{ data: { accepted, duplicates } }`. Auth is
 * optional: the token is sent when there is one, so the user and device are recorded.
 * 1..20 errors, already redacted. `429` → the caller keeps them.
 */
export async function reportClientErrors(body: ClientErrorsRequest): Promise<ClientErrorsAccepted> {
  const response = await api.post<DataEnvelope<ClientErrorsAccepted>>(CLIENT_ERRORS_PATH, body);
  return response.data;
}

const ERROR_LOG = '/api/v1/admin/error-log';

/** GET /api/v1/admin/error-log (`system.manage`): groups, `last_seen_at` desc, with `meta.summary`. */
export async function listErrorGroups(params: ErrorLogQuery = {}): Promise<ErrorLogListResponse> {
  return api.get<ErrorLogListResponse>(
    `${ERROR_LOG}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      status: params.status,
      source: params.source,
      level: params.level,
      search: params.search,
      from: params.from,
      to: params.to,
    })}`,
  );
}

/** GET /api/v1/admin/error-log/{group}: the group plus its latest 50 `events`. */
export async function getErrorGroup(id: number): Promise<ErrorGroupDetail> {
  const response = await api.get<DataEnvelope<ErrorGroupDetail>>(`${ERROR_LOG}/${id}`);
  return response.data;
}

/** POST /api/v1/admin/error-log/{group}/resolve → 200 group. */
export async function resolveErrorGroup(id: number): Promise<ErrorGroup> {
  const response = await api.post<DataEnvelope<ErrorGroup>>(`${ERROR_LOG}/${id}/resolve`);
  return response.data;
}

/** POST /api/v1/admin/error-log/{group}/reopen → 200 group. */
export async function reopenErrorGroup(id: number): Promise<ErrorGroup> {
  const response = await api.post<DataEnvelope<ErrorGroup>>(`${ERROR_LOG}/${id}/reopen`);
  return response.data;
}
