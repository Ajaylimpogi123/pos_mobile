/**
 * Feature: Dashboard (Phase 1c). One endpoint feeds the dashboard; every
 * section is permission-gated server-side and is `null` when the caller may
 * not see it. Only real data: nothing here estimates or fills in figures.
 */
import { api } from '@/services/api';
import type { Dashboard, DataEnvelope } from '@/services/types';

/** GET /api/v1/dashboard (any authenticated user). */
export async function getDashboard(): Promise<Dashboard> {
  const response = await api.get<DataEnvelope<Dashboard>>('/api/v1/dashboard');
  return response.data;
}
