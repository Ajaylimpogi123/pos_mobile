/**
 * The error log (Hardening & Pilot §B), permission `system.manage`: error groups
 * (app and server), their latest 50 events, resolve and reopen.
 */
import { api, buildQuery } from '@/services/api';
import type { DataEnvelope, ErrorGroup, ErrorGroupDetail, ErrorLogListResponse, ErrorLogQuery } from '@/services/types';

const ERROR_LOG = '/api/v1/admin/error-log';

/** GET /api/v1/admin/error-log: by `last_seen_at` desc; `status` defaults to `open`; `meta.summary`. */
export async function listErrorGroups(query: ErrorLogQuery = {}): Promise<ErrorLogListResponse> {
  return api.get<ErrorLogListResponse>(
    `${ERROR_LOG}${buildQuery({
      per_page: query.per_page,
      cursor: query.cursor,
      status: query.status,
      source: query.source,
      level: query.level,
      search: query.search,
      from: query.from,
      to: query.to,
    })}`,
  );
}

/** GET /api/v1/admin/error-log/{group}: the group plus its latest 50 events. */
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
