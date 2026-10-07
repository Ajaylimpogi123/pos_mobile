import { useCallback, useState } from 'react';

import { useShell } from '@/components/shell/ShellContext';
import { useDashboard } from '@/hooks/dashboard/useDashboard';
import { dashboardColumnsFor, useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';

export type ChartKey =
  | 'productsByCategory'
  | 'marginByCategory'
  | 'staffByRole'
  | 'activity'
  | 'salesTrend'
  | 'paymentMethods';

/**
 * Everything the dashboard screen needs: the query, pull-to-refresh, the
 * layout columns, and which charts show their "View as table" view. The
 * table toggles live here (above any layout switch), so a rotation that moves
 * a chart to another column never resets them.
 */
export function useDashboardScreen() {
  const query = useDashboard();
  const responsive = useResponsive();
  const { sidebarExpanded } = useShell();
  const user = useSessionStore((state) => state.user);
  const isOffline = useSessionStore((state) => state.isOffline);
  const [refreshing, setRefreshing] = useState(false);
  const [tables, setTables] = useState<ReadonlySet<ChartKey>>(() => new Set());
  /** When the screen opened: the clock for relative times until the first response arrives. */
  const [openedAt] = useState(() => Date.now());

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const toggleTable = useCallback((key: ChartKey) => {
    setTables((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return {
    query,
    user,
    isOffline,
    responsive,
    columns: dashboardColumnsFor(responsive, sidebarExpanded),
    openedAt,
    refreshing,
    refresh,
    tables,
    toggleTable,
  };
}
