import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { queryKeys } from '@/hooks/dashboard/queryKeys';
import { getDashboard } from '@/services/dashboard';

/**
 * GET /api/v1/dashboard through TanStack Query. Refetches whenever the
 * dashboard screen regains focus (e.g. back from editing a product), so the
 * figures follow what was just changed; the first focus is the initial load.
 */
export function useDashboard() {
  const query = useQuery({ queryKey: queryKeys.dashboard, queryFn: getDashboard });
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
