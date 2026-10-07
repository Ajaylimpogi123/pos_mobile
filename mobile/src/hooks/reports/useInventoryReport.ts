import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useInventoryCategories } from '@/hooks/inventory/useInventory';
import { useCsvExport } from '@/hooks/reports/useCsvExport';
import type { ReportRangeState } from '@/hooks/reports/useReportRange';
import { exportInventoryReport, getInventoryReport } from '@/services/reports';
import type { InventoryReportParams, StockStatusFilter } from '@/services/types';

/** The report's status filter (`all` sends none). */
export type InventoryReportStatus = 'all' | StockStatusFilter;

export const INVENTORY_STATUS_OPTIONS: readonly { value: InventoryReportStatus; label: string }[] = [
  { value: 'all', label: 'Every status' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
  { value: 'alerts', label: 'Low & out' },
];

/**
 * The Inventory view of Reports (`report.view`): the shared date range, a
 * category and a (current) status filter, `GET /reports/inventory` (the
 * previous result stays on screen while a new one loads), and **Export CSV**
 * from `GET /reports/inventory/export`, shared as `Export inventory report`.
 */
export function useInventoryReport(range: ReportRangeState, enabled = true) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<InventoryReportStatus>('all');
  const categories = useInventoryCategories(enabled);

  const params: InventoryReportParams | null = range.range
    ? {
        from: range.range.from,
        to: range.range.to,
        ...(categoryId === null ? {} : { category_id: categoryId }),
        ...(status === 'all' ? {} : { status }),
      }
    : null;

  const query = useQuery({
    queryKey: ['reports', 'inventory', params] as const,
    queryFn: () => getInventoryReport(params as InventoryReportParams),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });

  const csv = useCsvExport(params, exportInventoryReport, 'Export inventory report');

  return {
    range,
    categories,
    categoryId,
    setCategoryId,
    status,
    setStatus,
    filtersActive: categoryId !== null || status !== 'all',
    clearFilters: () => {
      setCategoryId(null);
      setStatus('all');
    },
    query,
    updating: query.isFetching && query.isPlaceholderData,
    ...csv,
  };
}

export type InventoryReportState = ReturnType<typeof useInventoryReport>;
