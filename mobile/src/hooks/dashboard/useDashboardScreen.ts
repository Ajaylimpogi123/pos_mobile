import { useCallback, useMemo, useState } from 'react';

import { useShell } from '@/components/shell/ShellContext';
import {
  dashboardParams,
  CURRENT_LABEL,
  DEFAULT_DASHBOARD_FILTER,
  isCurrentPeriod,
  periodLabel,
  shiftAnchor,
  type DashboardFilter,
} from '@/hooks/dashboard/dashboardPeriod';
import { useDashboard } from '@/hooks/dashboard/useDashboard';
import { dashboardColumnsFor, useResponsive } from '@/hooks/useResponsive';
import { isApiValidationError } from '@/services/api';
import type { DashboardPeriod } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

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
 *
 * Dashboard Period Filter (v1.28 §D): the Day · Month · Year filter and its
 * date stepper. "Today" is the server's `business_date`, never the device
 * clock; until the first response arrives the stepper is disabled. A `422`
 * (e.g. on `date`) resets the filter to Day / today.
 */
export function useDashboardScreen() {
  const [filter, setFilter] = useState<DashboardFilter>(DEFAULT_DASHBOARD_FILTER);
  const params = useMemo(() => dashboardParams(filter), [filter]);
  const query = useDashboard(params);
  const responsive = useResponsive();
  const { sidebarExpanded } = useShell();
  const user = useSessionStore((state) => state.user);
  const isOffline = useSessionStore((state) => state.isOffline);
  const [refreshing, setRefreshing] = useState(false);
  const [tables, setTables] = useState<ReadonlySet<ChartKey>>(() => new Set());
  /** When the screen opened: the clock for relative times until the first response arrives. */
  const [openedAt] = useState(() => Date.now());

  const today = query.data?.business_date ?? null;
  const anchor = filter.date ?? today;
  const isCurrent = anchor === null || today === null || isCurrentPeriod(filter.period, anchor, today);

  // A 422 (e.g. `date` after the business date) puts the filter back on Day / today.
  // Adjusted during render (React's pattern for state derived from a change), not in an effect.
  if (isApiValidationError(query.error) && filter !== DEFAULT_DASHBOARD_FILTER) {
    setFilter(DEFAULT_DASHBOARD_FILTER);
  }

  /** Switching the segment keeps the anchor date (5 Oct, Month → October 2026). */
  const setPeriod = useCallback((period: DashboardPeriod) => {
    setFilter((current) => ({ ...current, period }));
  }, []);
  const step = useCallback(
    (direction: -1 | 1) => {
      if (today === null) return;
      setFilter((current) => {
        const from = current.date ?? today;
        if (direction === 1 && isCurrentPeriod(current.period, from, today)) return current;
        return { ...current, date: shiftAnchor(current.period, from, direction, today) };
      });
    },
    [today],
  );
  const stepBack = useCallback(() => step(-1), [step]);
  const stepForward = useCallback(() => step(1), [step]);

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
    period: {
      /** Only users who see the `sales` section (`report.view`) get the filter. */
      visible: hasPermission(user, PERMISSIONS.reportView),
      value: filter.period,
      // Before the first response the filter is Day / today: its label needs no date.
      label: anchor !== null && today !== null ? periodLabel(filter.period, anchor, today) : CURRENT_LABEL[filter.period],
      canGoBack: today !== null,
      canGoForward: !isCurrent,
      /** Another period is loading while the previous figures stay on screen. */
      loading: query.isPlaceholderData && query.isFetching,
      setPeriod,
      stepBack,
      stepForward,
    },
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
