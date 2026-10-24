import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { queryKeys } from '@/hooks/dashboard/queryKeys';
import { getDashboard } from '@/services/dashboard';
import type { DashboardParams } from '@/services/types';

/**
 * GET /api/v1/dashboard through TanStack Query, for the chosen period
 * (v1.28). Refetches whenever the dashboard screen regains focus (e.g. back
 * from editing a product), so the figures follow what was just changed; the
 * first focus is the initial load. While another period loads, the previous
 * response stays on screen (`placeholderData`), so the cards never blank.
 */
export function useDashboard(params: DashboardParams = {}) {
  const query = useQuery({
    queryKey: queryKeys.dashboardFor(params),
    queryFn: () => getDashboard(params),
    placeholderData: keepPreviousData,
  });
  const focusedOnce = useRef(false);
  const { refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) void refetch();
      focusedOnce.current = true;
    }, [refetch]),
  );

  return query;
}
