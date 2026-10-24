/**
 * The report views' state: each holds its own filters over the shared date
 * range (`useReportRange`), runs its query only while it is shown (the
 * previous result stays on screen while a new one loads), and offers its CSV.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useCsvExport } from '@/hooks/reports/useCsvExport';
import type { ReportRangeState } from '@/hooks/reports/useReportRange';
import {
  exportInventoryReport,
  exportPurchasingReport,
  exportSalesReport,
  getIngredientReport,
  getInventoryReport,
  getPurchasingReport,
  getSalesReport,
} from '@/services/reports';
import type {
  PurchaseDecision,
  PurchaseItemType,
  PurchaseLineReceivingStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  PurchasingReportParams,
  SalesReportGroupBy,
  SalesReportParams,
  StockStatusFilter,
} from '@/services/types';

export const reportKeys = {
  all: ['reports'] as const,
  sales: (params: SalesReportParams | null) => ['reports', 'sales', params] as const,
  inventory: (params: unknown) => ['reports', 'inventory', params] as const,
  ingredients: (params: unknown) => ['reports', 'inventory-ingredients', params] as const,
  purchasing: (params: PurchasingReportParams | null) => ['reports', 'purchasing', params] as const,
};

export const GROUP_BY_OPTIONS: readonly { value: SalesReportGroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'product', label: 'Product' },
  { value: 'category', label: 'Category' },
  { value: 'payment', label: 'Payment' },
  { value: 'cashier', label: 'Cashier' },
];

function viewState<T>(query: { isFetching: boolean; isPlaceholderData: boolean; data: T | undefined }) {
  /** New results are loading while the previous ones stay on screen. */
  return { updating: query.isFetching && query.isPlaceholderData };
}

/** Sales (`report.view`): `GET /reports/sales` with a `group_by`, and its CSV. */
export function useSalesReport(range: ReportRangeState, enabled: boolean) {
  const [groupBy, setGroupBy] = useState<SalesReportGroupBy>('day');
  const params: SalesReportParams | null = range.range ? { ...range.range, group_by: groupBy } : null;
  const query = useQuery({
    queryKey: reportKeys.sales(params),
    queryFn: () => getSalesReport(params as SalesReportParams),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });
  return { groupBy, setGroupBy, query, ...viewState(query), ...useCsvExport(params, exportSalesReport) };
}

export type SalesReportState = ReturnType<typeof useSalesReport>;

/** Inventory → Products (`report.view`): category and status filters, and the CSV. */
export function useInventoryReport(range: ReportRangeState, enabled: boolean) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<StockStatusFilter | 'all'>('all');
  const params = range.range
    ? { ...range.range, ...(categoryId === null ? {} : { category_id: categoryId }), ...(status === 'all' ? {} : { status }) }
    : null;
  const query = useQuery({
    queryKey: reportKeys.inventory(params),
    queryFn: () => getInventoryReport(params as NonNullable<typeof params>),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });
  const csv = useCsvExport(params ? { ...params, kind: 'products' as const } : null, exportInventoryReport);
  return { categoryId, setCategoryId, status, setStatus, query, ...viewState(query), ...csv };
}

export type InventoryReportState = ReturnType<typeof useInventoryReport>;

/** Inventory → Ingredients (§D `kind=ingredients`): a status filter, and the CSV of the same kind. */
export function useIngredientReport(range: ReportRangeState, enabled: boolean) {
  const [status, setStatus] = useState<StockStatusFilter | 'all'>('all');
  const params = range.range ? { ...range.range, ...(status === 'all' ? {} : { status }) } : null;
  const query = useQuery({
    queryKey: reportKeys.ingredients(params),
    queryFn: () => getIngredientReport(params as NonNullable<typeof params>),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });
  const csv = useCsvExport(params ? { ...params, kind: 'ingredients' as const } : null, exportInventoryReport);
  return { status, setStatus, query, ...viewState(query), ...csv };
}

export type IngredientReportState = ReturnType<typeof useIngredientReport>;

/** A picked filter value with the name shown on its button. */
export type NamedFilter = { id: number; name: string };
export type ItemFilter = NamedFilter & { type: PurchaseItemType };

/**
 * Purchasing (§I; `report.view` or `purchase.approve`): the PR status,
 * decision, PO status, line receiving status, supplier and item filters, and the CSV.
 */
export function usePurchasingReport(range: ReportRangeState, enabled: boolean) {
  const [status, setStatus] = useState<PurchaseRequestStatus | 'all'>('all');
  const [decision, setDecision] = useState<PurchaseDecision | 'all'>('all');
  const [poStatus, setPoStatus] = useState<PurchaseOrderStatus | 'all'>('all');
  const [receiving, setReceiving] = useState<PurchaseLineReceivingStatus | 'all'>('all');
  const [supplier, setSupplier] = useState<NamedFilter | null>(null);
  const [item, setItem] = useState<ItemFilter | null>(null);

  const params: PurchasingReportParams | null = range.range
    ? {
        ...range.range,
        ...(status === 'all' ? {} : { status }),
        ...(decision === 'all' ? {} : { decision }),
        ...(poStatus === 'all' ? {} : { po_status: poStatus }),
        ...(receiving === 'all' ? {} : { receiving_status: receiving }),
        ...(supplier ? { supplier_id: supplier.id } : {}),
        ...(item ? { item_type: item.type, item_id: item.id } : {}),
      }
    : null;

  const query = useQuery({
    queryKey: reportKeys.purchasing(params),
    queryFn: () => getPurchasingReport(params as PurchasingReportParams),
    enabled: enabled && params !== null,
    placeholderData: keepPreviousData,
  });

  const filtersActive = status !== 'all' || decision !== 'all' || poStatus !== 'all' || receiving !== 'all' || supplier !== null || item !== null;

  return {
    status,
    setStatus,
    decision,
    setDecision,
    poStatus,
    setPoStatus,
    receiving,
    setReceiving,
    supplier,
    setSupplier,
    item,
    setItem,
    filtersActive,
    clearFilters: () => {
      setStatus('all');
      setDecision('all');
      setPoStatus('all');
      setReceiving('all');
      setSupplier(null);
      setItem(null);
    },
    query,
    ...viewState(query),
    ...useCsvExport(params, exportPurchasingReport),
  };
}

export type PurchasingReportState = ReturnType<typeof usePurchasingReport>;
