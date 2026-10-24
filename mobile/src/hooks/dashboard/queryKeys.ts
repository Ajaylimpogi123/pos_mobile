import type { DashboardParams } from '@/services/types';

/**
 * TanStack Query keys for the dashboard (one endpoint). `dashboard` is the
 * prefix of every period-filtered key, so invalidating `queryKeys.dashboard`
 * (after a sale, refund or stock change) also hits the filtered query.
 */
export const queryKeys = {
  dashboard: ['dashboard'] as const,
  dashboardFor: (params: DashboardParams) => ['dashboard', params] as const,
};
