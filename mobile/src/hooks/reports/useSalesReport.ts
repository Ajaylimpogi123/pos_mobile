import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { ReportRangeState } from '@/hooks/reports/useReportRange';
import { useCsvExport } from '@/hooks/reports/useCsvExport';
import { exportSalesReport, getSalesReport } from '@/services/reports';
import type { SalesReportGroupBy, SalesReportParams } from '@/services/types';

export {
  clampRange,
  MAX_RANGE_DAYS,
  presetRange,
  RANGE_PRESETS,
  type DateRange,
  type RangePreset,
} from '@/hooks/reports/useReportRange';

export const GROUP_BY_OPTIONS: readonly { value: SalesReportGroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'product', label: 'Product' },
  { value: 'category', label: 'Category' },
  { value: 'payment', label: 'Payment' },
  { value: 'cashier', label: 'Cashier' },
];

/**
 * The Sales view of Reports (`report.view`): the shared date range, a
 * `group_by`, `GET /reports/sales` (the previous result stays on screen while
 * a new one loads), and **Export CSV**: the same query from
 * `GET /reports/sales/export`, saved and shared (`@/utils/csvShare`).
 * Everything the user picked lives above the layout switch.
 */
export function useSalesReport(range: ReportRangeState, enabled = true) {
  const [groupBy, setGroupBy] = useState<SalesReportGroupBy>('day');
  const params: SalesReportParams | null = range.range ? { from: range.range.from, to: range.range.to, group_by: groupBy } : null;

  const query = useQuery({
    queryKey: ['reports', 'sales', params] as const,
    queryFn: () => getSalesReport(params as SalesReportParams),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });

  const csv = useCsvExport(params, exportSalesReport, 'Export sales report');

  return {
    ...range,
    groupBy,
    setGroupBy,
    query,
    /** New results are loading while the previous ones stay on screen. */
    updating: query.isFetching && query.isPlaceholderData,
    ...csv,
  };
}

export type SalesReportState = ReturnType<typeof useSalesReport>;
