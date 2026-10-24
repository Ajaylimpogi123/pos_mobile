/**
 * Inventory report (`GET /reports/inventory`; Inventory (v1 completion),
 * §D `kind`, Q-022, Q-028): a `Products | Ingredients` switch, the status
 * filter (and the category for products), the totals, and one row per tracked
 * item with its period flows: opening + received − sold/used + returned −
 * wasted + adjusted = closing. Status, reorder level, cost and value describe now.
 */
import { useMemo, type ReactNode } from 'react';

import { ToneBadge } from '@/components/common/ToneBadge';
import { ReportFrame, ReportTotals, type ReportTotal } from '@/components/reports/ReportParts';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { averageCostText, STOCK_STATUS } from '@/constants/inventoryLabels';
import type { IngredientReportState, InventoryReportState } from '@/hooks/reports/useReports';
import { useInventoryCategories } from '@/hooks/useInventory';
import type { IngredientReportRow, IngredientReportTotals, InventoryReportKind, InventoryReportRow, StockStatusFilter } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount, NO_VALUE } from '@pos/core/numbers';
import { formatQty } from '@pos/core/quantity';

const STATUS_OPTIONS: readonly { value: StockStatusFilter | 'all'; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
  { value: 'alerts', label: 'Low & out' },
];

const BRANCH_NOTE = 'Tracked, Low, Out and Stock value are for the whole branch, now. The flows cover the range and every item matching the filters.';

function StatusSelect({ id, value, onChange }: { id: string; value: StockStatusFilter | 'all'; onChange: (value: StockStatusFilter | 'all') => void }) {
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-44">
      <Label htmlFor={id}>Current status</Label>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value as StockStatusFilter | 'all')}>
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function KindSwitch({ kind, onChange }: { kind: InventoryReportKind; onChange: (kind: InventoryReportKind) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id="inventory-report-kind">
        Of
      </span>
      <Tabs value={kind} onValueChange={(value) => onChange(value as InventoryReportKind)}>
        <TabsList aria-labelledby="inventory-report-kind">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

const productColumn = dataTableColumns<InventoryReportRow>();

function flow(value: number): string {
  return formatCount(value);
}

type InventoryViewProps = {
  kind: InventoryReportKind;
  onKindChange: (kind: InventoryReportKind) => void;
  products: InventoryReportState;
  ingredients: IngredientReportState;
};

export function InventoryReportView({ kind, onKindChange, products, ingredients }: InventoryViewProps) {
  return kind === 'ingredients' ? (
    <IngredientReportView report={ingredients} kindSwitch={<KindSwitch kind={kind} onChange={onKindChange} />} />
  ) : (
    <ProductReportView report={products} kindSwitch={<KindSwitch kind={kind} onChange={onKindChange} />} />
  );
}

function ProductReportView({ report, kindSwitch }: { report: InventoryReportState; kindSwitch: ReactNode }) {
  const categories = useInventoryCategories();
  const result = report.query.data;
  const data = result?.report;

  const columns = useMemo<DataTableColumn<InventoryReportRow>[]>(
    () => [
      productColumn.display({
        id: 'name',
        header: 'Product',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-[13px] text-muted-foreground">{row.original.category_name}</span>
          </div>
        ),
      }),
      productColumn.display({ id: 'opening', header: 'Opening', meta: { align: 'right' }, cell: ({ row }) => flow(row.original.opening_qty) }),
      productColumn.display({ id: 'received', header: 'Received', meta: { align: 'right' }, cell: ({ row }) => flow(row.original.received) }),
      productColumn.display({ id: 'sold', header: 'Sold', meta: { align: 'right' }, cell: ({ row }) => flow(row.original.sold) }),
      productColumn.display({ id: 'returned', header: 'Returned', meta: { align: 'right' }, cell: ({ row }) => flow(row.original.returned) }),
      productColumn.display({ id: 'wasted', header: 'Wasted', meta: { align: 'right' }, cell: ({ row }) => flow(row.original.wasted) }),
      productColumn.display({ id: 'adjusted', header: 'Adjusted', meta: { align: 'right' }, cell: ({ row }) => flow(row.original.adjusted) }),
      productColumn.display({
        id: 'closing',
        header: 'Closing',
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold">{flow(row.original.closing_qty)}</span>,
      }),
      productColumn.display({
        id: 'reorder',
        header: 'Reorder at',
        meta: { align: 'right' },
        cell: ({ row }) => (row.original.reorder_level === null ? NO_VALUE : formatCount(row.original.reorder_level)),
      }),
      productColumn.display({ id: 'status', header: 'Status', cell: ({ row }) => <ToneBadge info={STOCK_STATUS[row.original.status]} /> }),
      productColumn.display({ id: 'cost', header: 'Unit cost', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.unit_cost_cents) }),
      productColumn.display({ id: 'value', header: 'Stock value', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.stock_value_cents) }),
    ],
    [],
  );

  const totals: ReportTotal[] = data
    ? [
        { key: 'value', label: 'Stock value', value: formatPeso(data.totals.stock_value_cents), emphasis: true },
        { key: 'tracked', label: 'Tracked', value: formatCount(data.totals.tracked) },
        { key: 'low', label: 'Low', value: formatCount(data.totals.low) },
        { key: 'out', label: 'Out', value: formatCount(data.totals.out), tone: data.totals.out > 0 ? 'danger' : undefined },
        { key: 'received', label: 'Received', value: flow(data.totals.received) },
        { key: 'sold', label: 'Sold', value: flow(data.totals.sold) },
        { key: 'returned', label: 'Returned', value: flow(data.totals.returned) },
        { key: 'wasted', label: 'Wasted', value: flow(data.totals.wasted) },
        { key: 'adjusted', label: 'Adjusted', value: flow(data.totals.adjusted) },
      ]
    : [];

  const footer = data
    ? {
        name: 'Total',
        received: flow(data.totals.received),
        sold: flow(data.totals.sold),
        returned: flow(data.totals.returned),
        wasted: flow(data.totals.wasted),
        adjusted: flow(data.totals.adjusted),
        value: formatPeso(data.totals.stock_value_cents),
      }
    : undefined;

  const filtered = report.categoryId !== null || report.status !== 'all';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {kindSwitch}
        <div className="flex w-full flex-col gap-1.5 sm:w-56">
          <Label htmlFor="inventory-report-category">Category</Label>
          <NativeSelect
            id="inventory-report-category"
            value={report.categoryId === null ? '' : String(report.categoryId)}
            onChange={(event) => report.setCategoryId(event.target.value === '' ? null : Number(event.target.value))}
            disabled={categories.loading}
          >
            <option value="">{categories.error ? 'All categories (list unavailable)' : 'All categories'}</option>
            {categories.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <StatusSelect id="inventory-report-status" value={report.status} onChange={report.setStatus} />
      </div>
      <ReportFrame
        query={report.query}
        hasData={data !== undefined}
        empty={
          data && data.rows.length === 0
            ? filtered
              ? { title: 'No matching products', message: 'Try another category or status.' }
              : { title: 'No tracked products', message: "Set a product's stock mode to Own stock to track it here." }
            : null
        }
        truncated={result?.truncated === true}
        updating={report.updating}
        exportError={report.exportError}
        onDismissExportError={report.dismissExportError}
        noun="inventory report"
      >
        {data ? (
          <>
            <ReportTotals totals={totals} note={BRANCH_NOTE} />
            <Card className="overflow-hidden">
              <DataTable label="Inventory report" columns={columns} data={data.rows} getRowId={(row) => String(row.product_id)} footer={footer} />
            </Card>
          </>
        ) : null}
      </ReportFrame>
    </div>
  );
}

const ingredientColumn = dataTableColumns<IngredientReportRow>();

/** The totals the server sent (Q-028: the app shows the ones it finds). */
function ingredientTotals(totals: IngredientReportTotals): ReportTotal[] {
  const list: ReportTotal[] = [];
  if (totals.stock_value_cents !== undefined) list.push({ key: 'value', label: 'Stock value', value: formatPeso(totals.stock_value_cents), emphasis: true });
  if (totals.tracked !== undefined) list.push({ key: 'tracked', label: 'Tracked', value: formatCount(totals.tracked) });
  if (totals.low !== undefined) list.push({ key: 'low', label: 'Low', value: formatCount(totals.low) });
  if (totals.out !== undefined) list.push({ key: 'out', label: 'Out', value: formatCount(totals.out), tone: totals.out > 0 ? 'danger' : undefined });
  if (totals.value_in_cents !== undefined) list.push({ key: 'in', label: 'Value in', value: formatPeso(totals.value_in_cents) });
  if (totals.value_out_cents !== undefined) list.push({ key: 'out-value', label: 'Value out', value: formatPeso(totals.value_out_cents) });
  return list;
}

function IngredientReportView({ report, kindSwitch }: { report: IngredientReportState; kindSwitch: ReactNode }) {
  const result = report.query.data;
  const data = result?.report;

  const columns = useMemo<DataTableColumn<IngredientReportRow>[]>(
    () => [
      ingredientColumn.display({
        id: 'name',
        header: 'Ingredient',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-[13px] text-muted-foreground">In {row.original.base_unit}</span>
          </div>
        ),
      }),
      ingredientColumn.display({ id: 'opening', header: 'Opening', meta: { align: 'right' }, cell: ({ row }) => formatQty(row.original.opening_qty) }),
      ingredientColumn.display({ id: 'received', header: 'Received', meta: { align: 'right' }, cell: ({ row }) => formatQty(row.original.received) }),
      ingredientColumn.display({ id: 'used', header: 'Used', meta: { align: 'right' }, cell: ({ row }) => formatQty(row.original.used) }),
      ingredientColumn.display({ id: 'returned', header: 'Returned', meta: { align: 'right' }, cell: ({ row }) => formatQty(row.original.returned) }),
      ingredientColumn.display({ id: 'wasted', header: 'Wasted', meta: { align: 'right' }, cell: ({ row }) => formatQty(row.original.wasted) }),
      ingredientColumn.display({ id: 'adjusted', header: 'Adjusted', meta: { align: 'right' }, cell: ({ row }) => formatQty(row.original.adjusted) }),
      ingredientColumn.display({
        id: 'closing',
        header: 'Closing',
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold">{formatQty(row.original.closing_qty)}</span>,
      }),
      ingredientColumn.display({
        id: 'reorder',
        header: 'Reorder at',
        meta: { align: 'right' },
        cell: ({ row }) => (row.original.reorder_level === null ? NO_VALUE : formatQty(row.original.reorder_level)),
      }),
      ingredientColumn.display({ id: 'status', header: 'Status', cell: ({ row }) => <ToneBadge info={STOCK_STATUS[row.original.status]} /> }),
      ingredientColumn.display({
        id: 'avg',
        header: 'Average cost',
        meta: { align: 'right' },
        cell: ({ row }) => averageCostText({ avg_cost: row.original.avg_cost, base_unit: row.original.base_unit }),
      }),
      ingredientColumn.display({ id: 'value', header: 'Stock value', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.stock_value_cents) }),
      ingredientColumn.display({ id: 'in', header: 'Value in', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.value_in_cents) }),
      ingredientColumn.display({ id: 'outValue', header: 'Value out', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.value_out_cents) }),
    ],
    [],
  );

  const footer = data
    ? {
        name: 'Total',
        ...(data.totals.stock_value_cents !== undefined ? { value: formatPeso(data.totals.stock_value_cents) } : {}),
        ...(data.totals.value_in_cents !== undefined ? { in: formatPeso(data.totals.value_in_cents) } : {}),
        ...(data.totals.value_out_cents !== undefined ? { outValue: formatPeso(data.totals.value_out_cents) } : {}),
      }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {kindSwitch}
        <StatusSelect id="ingredient-report-status" value={report.status} onChange={report.setStatus} />
      </div>
      <ReportFrame
        query={report.query}
        hasData={data !== undefined}
        empty={
          data && data.rows.length === 0
            ? report.status !== 'all'
              ? { title: 'No matching ingredients', message: 'Try another status.' }
              : { title: 'No ingredients yet', message: 'Ingredients show here once they are added on the Ingredients page.' }
            : null
        }
        truncated={result?.truncated === true}
        updating={report.updating}
        exportError={report.exportError}
        onDismissExportError={report.dismissExportError}
        noun="ingredient report"
      >
        {data ? (
          <>
            <ReportTotals totals={ingredientTotals(data.totals)} note={BRANCH_NOTE} />
            <Card className="overflow-hidden">
              <DataTable label="Ingredient report" columns={columns} data={data.rows} getRowId={(row) => String(row.ingredient_id)} footer={footer} />
            </Card>
          </>
        ) : null}
      </ReportFrame>
    </div>
  );
}
