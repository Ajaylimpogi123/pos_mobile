/**
 * GET /api/v1/dashboard through TanStack Query. The dashboard is a live
 * overview, so it refetches when the window regains focus and every 5 minutes
 * while open (a failed refresh keeps the last figures on screen).
 *
 * v1.28: the key is `['dashboard', params]`, so `dashboardKeys.all` still
 * prefixes (and invalidates) every period. While another period loads, the
 * previous figures stay on screen (`isPlaceholderData`).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { getDashboard } from '@/services/dashboard';
import type { DashboardParams } from '@/services/types';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  period: (params: DashboardParams) => [...dashboardKeys.all, params] as const,
};

const REFRESH_MS = 5 * 60_000;

export function useDashboard(params: DashboardParams = {}) {
  return useQuery({
    queryKey: dashboardKeys.period(params),
    queryFn: () => getDashboard(params),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: REFRESH_MS,
  });
}
