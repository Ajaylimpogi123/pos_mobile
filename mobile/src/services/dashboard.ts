/**
 * Feature: Dashboard (Phase 1c). One endpoint feeds the dashboard; every
 * section is permission-gated server-side and is `null` when the caller may
 * not see it. Only real data: nothing here estimates or fills in figures.
 * Dashboard Period Filter (v1.28): `period` and `date` scope the `sales`
 * section only; each is sent only when set.
 */
import { api, buildQuery } from '@/services/api';
import type { Dashboard, DashboardParams, DataEnvelope } from '@/services/types';

/** GET /api/v1/dashboard (any authenticated user). */
export async function getDashboard(params: DashboardParams = {}): Promise<Dashboard> {
  const query = buildQuery({ period: params.period, date: params.date });
  const response = await api.get<DataEnvelope<Dashboard>>(`/api/v1/dashboard${query}`);
  return response.data;
}
