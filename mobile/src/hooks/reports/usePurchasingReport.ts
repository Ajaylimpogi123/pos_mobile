import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { DECISION, LINE_STATUS, PO_STATUS, PR_STATUS } from '@/components/purchasing/purchasingLabels';
import { useCsvExport } from '@/hooks/reports/useCsvExport';
import type { ReportRangeState } from '@/hooks/reports/useReportRange';
import { exportInventoryReport, exportPurchasingReport, getIngredientReport, getPurchasingReport } from '@/services/reports';
import type {
  PurchaseDecision,
  PurchaseLineReceivingStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  PurchasingReportParams,
  StockStatusFilter,
} from '@/services/types';

type Option<T extends string> = { value: T | 'all'; label: string };

function optionsOf<T extends string>(map: Record<T, { label: string }>, allLabel: string): Option<T>[] {
  return [{ value: 'all', label: allLabel }, ...(Object.keys(map) as T[]).map((value) => ({ value, label: map[value].label }))];
}

export const PR_STATUS_OPTIONS = optionsOf<PurchaseRequestStatus>(PR_STATUS, 'Any PR status');
export const DECISION_OPTIONS = optionsOf<PurchaseDecision>(DECISION, 'Any decision');
export const PO_STATUS_OPTIONS = optionsOf<PurchaseOrderStatus>(PO_STATUS, 'Any PO status');
/** Q-028: the line values (the server also accepts PO values). */
export const LINE_STATUS_OPTIONS = optionsOf<PurchaseLineReceivingStatus>(LINE_STATUS, 'Any receiving');

/**
 * The Purchasing view of Reports (§I; `report.view` or `purchase.approve`):
 * the shared date range (PR created date), the PR status, decision, PO
 * status and line receiving filters, `GET /reports/purchasing` (the previous
 * result stays on screen while a new one loads), and **Export CSV**
 * (`GET /reports/purchasing/export`, shared as `Export purchasing report`).
 */
export function usePurchasingReport(range: ReportRangeState, enabled = true) {
  const [status, setStatus] = useState<PurchaseRequestStatus | 'all'>('all');
  const [decision, setDecision] = useState<PurchaseDecision | 'all'>('all');
  const [poStatus, setPoStatus] = useState<PurchaseOrderStatus | 'all'>('all');
  const [receiving, setReceiving] = useState<PurchaseLineReceivingStatus | 'all'>('all');

  const params: PurchasingReportParams | null = range.range
    ? {
        from: range.range.from,
        to: range.range.to,
        ...(status === 'all' ? {} : { status }),
        ...(decision === 'all' ? {} : { decision }),
        ...(poStatus === 'all' ? {} : { po_status: poStatus }),
        ...(receiving === 'all' ? {} : { receiving_status: receiving }),
      }
    : null;

  const query = useQuery({
    queryKey: ['reports', 'purchasing', params] as const,
    queryFn: () => getPurchasingReport(params as PurchasingReportParams),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });

  const csv = useCsvExport(params, exportPurchasingReport, 'Export purchasing report');

  return {
    range,
    status,
    setStatus,
    decision,
    setDecision,
    poStatus,
    setPoStatus,
    receiving,
    setReceiving,
    filtersActive: status !== 'all' || decision !== 'all' || poStatus !== 'all' || receiving !== 'all',
    clearFilters: () => {
      setStatus('all');
      setDecision('all');
      setPoStatus('all');
      setReceiving('all');
    },
    query,
    updating: query.isFetching && query.isPlaceholderData,
    ...csv,
  };
}

export type PurchasingReportState = ReturnType<typeof usePurchasingReport>;

/**
 * The inventory report's `Ingredients` kind (§D: `kind=ingredients`): the
 * shared range, a status filter, the report, and its CSV (the same export
 * with the kind).
 */
export function useIngredientReport(range: ReportRangeState, enabled = true) {
  const [status, setStatus] = useState<'all' | StockStatusFilter>('all');
  const params = range.range ? { from: range.range.from, to: range.range.to, ...(status === 'all' ? {} : { status }) } : null;

  const query = useQuery({
    queryKey: ['reports', 'inventory-ingredients', params] as const,
    queryFn: () => getIngredientReport(params as NonNullable<typeof params>),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });

  const csv = useCsvExport(params ? { ...params, kind: 'ingredients' as const } : null, exportInventoryReport, 'Export inventory report');

  return {
    range,
    status,
    setStatus,
    filtersActive: status !== 'all',
    clearFilters: () => setStatus('all'),
    query,
    updating: query.isFetching && query.isPlaceholderData,
    ...csv,
  };
}

export type IngredientReportState = ReturnType<typeof useIngredientReport>;
