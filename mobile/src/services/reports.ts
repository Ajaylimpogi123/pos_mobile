/**
 * Feature: Shifts & Reporting (Phase 6): sales reports (`report.view`). One
 * function per contract endpoint, through the shared client (`@/services/api`).
 */
import { apiRequestText, api, buildQuery } from '@/services/api';
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

const SALES_REPORT = '/api/v1/reports/sales';

function reportQuery(params: SalesReportParams): string {
  return buildQuery({ from: params.from, to: params.to, group_by: params.group_by });
}

export type SalesReportResult = {
  report: SalesReport;
  /** More than 500 rows exist: only the first 500 came back (`meta.truncated`). */
  truncated: boolean;
};

/** GET /api/v1/reports/sales: totals and rows for a business-date range, grouped by `group_by`. */
export async function getSalesReport(params: SalesReportParams): Promise<SalesReportResult> {
  const response = await api.get<SalesReportResponse>(`${SALES_REPORT}${reportQuery(params)}`);
  // Q-013: `meta` is always present; the read stays defensive.
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** The contract's file name: `sales-<group_by>-<from>-<to>.csv`. */
export function exportFileName(params: SalesReportParams): string {
  return `sales-${params.group_by}-${params.from}-${params.to}.csv`;
}

/** `attachment; filename="sales-day-2026-09-01-2026-09-26.csv"` → the file name (safe characters only), or `null`. */
export function fileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim() ?? '';
  // Only a plain file name is used: no paths, no odd characters.
  return /^[A-Za-z0-9._-]+\.csv$/.test(name) ? name : null;
}

export type SalesReportExport = {
  fileName: string;
  /** The CSV text (UTF-8). */
  csv: string;
};

/**
 * GET /api/v1/reports/sales/export: the same query as the report, answered
 * with `text/csv` (UTF-8 with BOM) and `Content-Disposition: attachment`.
 * Its errors are JSON, handled like every other request.
 */
export async function exportSalesReport(params: SalesReportParams): Promise<SalesReportExport> {
  const { text, contentDisposition } = await apiRequestText(`${SALES_REPORT}/export${reportQuery(params)}`);
  return { fileName: fileNameFromDisposition(contentDisposition) ?? exportFileName(params), csv: text };
}

// ---------------------------------------------------------------------------
// Inventory report (Inventory, v1 completion; `report.view`)
// ---------------------------------------------------------------------------

const INVENTORY_REPORT = '/api/v1/reports/inventory';

function inventoryReportQuery(params: InventoryReportParams): string {
  // `kind` is sent only for ingredients, so a products query stays exactly as before (the default).
  return buildQuery({
    from: params.from,
    to: params.to,
    kind: params.kind === 'ingredients' ? 'ingredients' : undefined,
    category_id: params.category_id,
    status: params.status,
  });
}

export type InventoryReportResult = {
  report: InventoryReport;
  /** More than 500 rows exist: only the first 500 came back (`meta.truncated`). */
  truncated: boolean;
};

/** GET /api/v1/reports/inventory: stock movements per tracked product over a business-date range. */
export async function getInventoryReport(params: InventoryReportParams): Promise<InventoryReportResult> {
  const response = await api.get<InventoryReportResponse>(`${INVENTORY_REPORT}${inventoryReportQuery(params)}`);
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** The contract's file name: `inventory-<from>-<to>.csv`. */
export function inventoryExportFileName(params: InventoryReportParams): string {
  // A fallback only (the server's Content-Disposition wins); the ingredient kind gets its own name.
  return params.kind === 'ingredients'
    ? `inventory-ingredients-${params.from}-${params.to}.csv`
    : `inventory-${params.from}-${params.to}.csv`;
}

/** GET /api/v1/reports/inventory/export: the same query, answered with CSV (errors stay JSON). */
export async function exportInventoryReport(params: InventoryReportParams): Promise<SalesReportExport> {
  const { text, contentDisposition } = await apiRequestText(`${INVENTORY_REPORT}/export${inventoryReportQuery(params)}`);
  return { fileName: fileNameFromDisposition(contentDisposition) ?? inventoryExportFileName(params), csv: text };
}

export type IngredientReportResult = {
  report: IngredientReport;
  /** More than 500 rows exist (`meta.truncated`). */
  truncated: boolean;
};

/** GET /api/v1/reports/inventory?kind=ingredients (Ingredients, Recipes & Purchasing §D; Q-028 row shape). */
export async function getIngredientReport(params: Omit<InventoryReportParams, 'kind' | 'category_id'>): Promise<IngredientReportResult> {
  const response = await api.get<IngredientReportResponse>(
    `${INVENTORY_REPORT}${inventoryReportQuery({ ...params, kind: 'ingredients' })}`,
  );
  return { report: response.data, truncated: response.meta?.truncated === true };
}

// ---------------------------------------------------------------------------
// Purchasing report (Ingredients, Recipes & Purchasing §I; `report.view` or `purchase.approve`)
// ---------------------------------------------------------------------------

const PURCHASING_REPORT = '/api/v1/reports/purchasing';

function purchasingReportQuery(params: PurchasingReportParams): string {
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

export type PurchasingReportResult = {
  report: PurchasingReport;
  /** More than 500 rows exist (`meta.truncated`). */
  truncated: boolean;
};

/** GET /api/v1/reports/purchasing: a row per PR item created in the range, with totals. */
export async function getPurchasingReport(params: PurchasingReportParams): Promise<PurchasingReportResult> {
  const response = await api.get<PurchasingReportResponse>(`${PURCHASING_REPORT}${purchasingReportQuery(params)}`);
  return { report: response.data, truncated: response.meta?.truncated === true };
}

/** Fallback file name when the server sends no `Content-Disposition` (Q-028): `purchasing-<from>-<to>.csv`. */
export function purchasingExportFileName(params: PurchasingReportParams): string {
  return `purchasing-${params.from}-${params.to}.csv`;
}

/** GET /api/v1/reports/purchasing/export: the same query as CSV (Phase 6 conventions; errors stay JSON). */
export async function exportPurchasingReport(params: PurchasingReportParams): Promise<SalesReportExport> {
  const { text, contentDisposition } = await apiRequestText(`${PURCHASING_REPORT}/export${purchasingReportQuery(params)}`);
  return { fileName: fileNameFromDisposition(contentDisposition) ?? purchasingExportFileName(params), csv: text };
}
