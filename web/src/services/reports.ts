/**
 * Reports: sales (Shifts & Reporting → Sales reports, Q-013, Q-019, Phase 7,
 * SC/PWD), inventory with its `kind` (Inventory (v1 completion), §D, Q-028)
 * and purchasing (§I, Q-028). One function per endpoint, through the shared
 * client. The CSV exports go through `apiDownload`, so the Bearer token stays
 * in the header and never in a URL.
 */
import { api, apiDownload, buildQuery } from '@/services/api';
import type {
  IngredientReport,
  IngredientReportResponse,
  InventoryReport,
  InventoryReportParams,
  InventoryReportResponse,
  PurchasingReport,
  PurchasingReportParams,
  PurchasingReportResponse,
  SalesReport,
  SalesReportParams,
  SalesReportResponse,
} from '@/services/types';

/** A report and whether its rows were capped at 500 (`meta.truncated`). */
export type ReportResult<T> = { report: T; truncated: boolean };

/** An export, ready to save: the CSV as a Blob and its file name. */
export type ReportFile = { blob: Blob; fileName: string };

/** `attachment; filename="sales-day-2026-09-01-2026-09-26.csv"` → the file name (safe characters only), or `null`. */
export function fileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim() ?? '';
  return /^[A-Za-z0-9._-]+\.csv$/.test(name) ? name : null;
}

async function download(path: string, fallbackName: string): Promise<ReportFile> {
  const { blob, contentDisposition } = await apiDownload(path);
  return { blob, fileName: fileNameFromDisposition(contentDisposition) ?? fallbackName };
}

// ---------------------------------------------------------------------------
// Sales (`report.view`)
// ---------------------------------------------------------------------------

const SALES_REPORT = '/api/v1/reports/sales';

function salesQuery(params: SalesReportParams): string {
  return buildQuery({ from: params.from, to: params.to, group_by: params.group_by });
}

/** GET /api/v1/reports/sales: totals and rows for a business-date range, grouped by `group_by`. */
export async function getSalesReport(params: SalesReportParams): Promise<ReportResult<SalesReport>> {
  const response = await api.get<SalesReportResponse>(`${SALES_REPORT}${salesQuery(params)}`);
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** GET /api/v1/reports/sales/export: the same query as CSV (`sales-<group_by>-<from>-<to>.csv`). */
export function exportSalesReport(params: SalesReportParams): Promise<ReportFile> {
  return download(`${SALES_REPORT}/export${salesQuery(params)}`, `sales-${params.group_by}-${params.from}-${params.to}.csv`);
}

// ---------------------------------------------------------------------------
// Inventory (`report.view`): products, or ingredients with `kind=ingredients`
// ---------------------------------------------------------------------------

const INVENTORY_REPORT = '/api/v1/reports/inventory';

function inventoryQuery(params: InventoryReportParams): string {
  // `kind` goes only for ingredients, so a products query is exactly the default one.
  return buildQuery({
    from: params.from,
    to: params.to,
    kind: params.kind === 'ingredients' ? 'ingredients' : undefined,
    // Q-028: `category_id` is ignored for ingredients, so it isn't sent.
    category_id: params.kind === 'ingredients' ? undefined : params.category_id,
    status: params.status,
  });
}

/** GET /api/v1/reports/inventory: stock movements per tracked product over a business-date range. */
export async function getInventoryReport(params: Omit<InventoryReportParams, 'kind'>): Promise<ReportResult<InventoryReport>> {
  const response = await api.get<InventoryReportResponse>(`${INVENTORY_REPORT}${inventoryQuery({ ...params, kind: 'products' })}`);
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** GET /api/v1/reports/inventory?kind=ingredients (§D; the Q-028 row shape). */
export async function getIngredientReport(
  params: Omit<InventoryReportParams, 'kind' | 'category_id'>,
): Promise<ReportResult<IngredientReport>> {
  const response = await api.get<IngredientReportResponse>(`${INVENTORY_REPORT}${inventoryQuery({ ...params, kind: 'ingredients' })}`);
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** GET /api/v1/reports/inventory/export: the same query as CSV (`inventory-…` or `inventory-ingredients-…`). */
export function exportInventoryReport(params: InventoryReportParams): Promise<ReportFile> {
  const fallback =
    params.kind === 'ingredients' ? `inventory-ingredients-${params.from}-${params.to}.csv` : `inventory-${params.from}-${params.to}.csv`;
  return download(`${INVENTORY_REPORT}/export${inventoryQuery(params)}`, fallback);
}

// ---------------------------------------------------------------------------
// Purchasing (`report.view` or `purchase.approve`)
// ---------------------------------------------------------------------------

const PURCHASING_REPORT = '/api/v1/reports/purchasing';

function purchasingQuery(params: PurchasingReportParams): string {
  return buildQuery({
    from: params.from,
    to: params.to,
    status: params.status,
    decision: params.decision,
    po_status: params.po_status,
    receiving_status: params.receiving_status,
    supplier_id: params.supplier_id,
    item_type: params.item_type,
    item_id: params.item_id,
  });
}

/** GET /api/v1/reports/purchasing: a row per PR item created in the range, with totals. */
export async function getPurchasingReport(params: PurchasingReportParams): Promise<ReportResult<PurchasingReport>> {
  const response = await api.get<PurchasingReportResponse>(`${PURCHASING_REPORT}${purchasingQuery(params)}`);
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** GET /api/v1/reports/purchasing/export: the same query as CSV (`purchasing-<from>-<to>.csv`). */
export function exportPurchasingReport(params: PurchasingReportParams): Promise<ReportFile> {
  return download(`${PURCHASING_REPORT}/export${purchasingQuery(params)}`, `purchasing-${params.from}-${params.to}.csv`);
}
