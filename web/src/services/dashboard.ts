/**
 * Dashboard (Phase 1c and every later revision): one endpoint, through the
 * shared client. Sections the caller may not see come back `null`.
 */
import { api, buildQuery } from '@/services/api';
import type { Dashboard, DashboardParams, DataEnvelope } from '@/services/types';

/**
 * GET /api/v1/dashboard: the caller's dashboard. v1.28: `period` and `date`
 * select the period of the `sales` section; each is sent only when set
 * (none = Day / today).
 */
export async function getDashboard(params: DashboardParams = {}): Promise<Dashboard> {
  const query = buildQuery({ period: params.period, date: params.date });
  const response = await api.get<DataEnvelope<Dashboard>>(`/api/v1/dashboard${query}`);
  return response.data;
}
