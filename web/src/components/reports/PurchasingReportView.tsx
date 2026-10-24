/**
 * Purchasing report (`GET /reports/purchasing`; §I, Q-028): every filter the
 * contract defines (PR status, decision, PO status, receiving status,
 * supplier, item), the totals, and one row per PR item with its decision,
 * PO line and receiving. PO fields are `null` (shown "—") without a PO line.
 */
import { XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ToneBadge } from '@/components/common/ToneBadge';
import { ItemPickerDialog, SupplierPickerDialog } from '@/components/purchasing/PurchasePickers';
import { ReportFrame, ReportTotals, type ReportTotal } from '@/components/reports/ReportParts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { DECISION, LINE_STATUS, PO_STATUS, PR_STATUS, statusFor } from '@/constants/purchasingLabels';
import type { PurchasingReportState } from '@/hooks/reports/useReports';
import type { PurchaseOrderStatus, PurchasingReportRow, PurchasingReportTotals } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBusinessDate } from '@/utils/dates';
import { hasAnyPermission, PERMISSIONS, PURCHASE_PERMISSIONS } from '@/utils/permissions';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatCount, NO_VALUE } from '@pos/core/numbers';
import { formatQty } from '@pos/core/quantity';

type Option = { value: string; label: string };

function optionsOf(map: Record<string, { label: string }>, allLabel: string): Option[] {
  return [{ value: 'all', label: allLabel }, ...Object.keys(map).map((value) => ({ value, label: map[value].label }))];
}

const PR_STATUS_OPTIONS = optionsOf(PR_STATUS, 'Any PR status');
const DECISION_OPTIONS = optionsOf(DECISION, 'Any decision');
const PO_STATUS_OPTIONS = optionsOf(PO_STATUS, 'Any PO status');
/** Q-028: the line values (the server also accepts PO values). */
const LINE_STATUS_OPTIONS = optionsOf(LINE_STATUS, 'Any receiving');

function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-48">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** A picked filter shown as a button that opens its picker, plus a clear button. */
function PickerFilter({ label, value, onOpen, onClear }: { label: string; value: string | null; onOpen: () => void; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" onClick={onOpen} aria-label={value ? `${label}: ${value}. Change` : `Choose ${label.toLowerCase()}`}>
          {value ?? `Any ${label.toLowerCase()}`}
        </Button>
        {value ? (
          <Button variant="ghost" size="icon" onClick={onClear} aria-label={`Clear ${label.toLowerCase()}`}>
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const column = dataTableColumns<PurchasingReportRow>();

function qty(value: PurchasingReportRow['ordered_qty']): string {
  return value === null ? NO_VALUE : formatQty(value);
}

function money(cents: number | null): string {
  return cents === null ? NO_VALUE : formatPeso(cents);
}

function purchasingTotals(totals: PurchasingReportTotals): ReportTotal[] {
  const pos = (Object.keys(PO_STATUS) as PurchaseOrderStatus[])
    .filter((status) => totals.pos[status] !== undefined)
    .map((status) => ({ key: `po-${status}`, label: `POs: ${PO_STATUS[status].label}`, value: formatCount(totals.pos[status] ?? 0) }));
  return [
    { key: 'ordered', label: 'Ordered', value: formatPeso(totals.ordered_cents), emphasis: true },
    { key: 'received', label: 'Received', value: formatPeso(totals.received_cents) },
    { key: 'remaining', label: 'Remaining', value: formatPeso(totals.remaining_cents) },
    { key: 'prs', label: 'Requests', value: formatCount(totals.prs) },
    { key: 'items', label: 'Items', value: formatCount(totals.items) },
    { key: 'approved', label: 'Approved items', value: formatCount(totals.approved) },
    { key: 'declined', label: 'Declined items', value: formatCount(totals.declined) },
    { key: 'pending', label: 'Pending items', value: formatCount(totals.pending) },
    ...pos,
  ];
}

export function PurchasingReportView({ report }: { report: PurchasingReportState }) {
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  // §C: the supplier list needs `supplier.manage` or a purchase permission.
  const canPickSupplier = useSessionStore((state) => hasAnyPermission(state.user, [PERMISSIONS.supplierManage, ...PURCHASE_PERMISSIONS]));
  const [picker, setPicker] = useState<'supplier' | 'item' | null>(null);
  const result = report.query.data;
  const data = result?.report;
  // A PR can list the same item twice, so rows are keyed by their position in the report.
  const rowIds = useMemo(() => new Map((data?.rows ?? []).map((row, index) => [row, String(index)])), [data]);

  const columns = useMemo<DataTableColumn<PurchasingReportRow>[]>(
    () => [
      column.display({
        id: 'pr',
        header: 'Request',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium tabular">{row.original.pr_no}</span>
            <span className="text-[13px] text-muted-foreground">
              {formatBusinessDate(row.original.pr_date)} · {row.original.requested_by}
            </span>
          </div>
        ),
      }),
      column.display({
        id: 'item',
        header: 'Item',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.item_name}</span>
            <span className="text-[13px] text-muted-foreground">{row.original.supplier_name}</span>
          </div>
        ),
      }),
      column.display({
        id: 'requested',
        header: 'Requested',
        meta: { align: 'right' },
        cell: ({ row }) => `${formatQty(row.original.requested_qty)} ${row.original.unit}`,
      }),
      column.display({
        id: 'decision',
        header: 'Decision',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <ToneBadge info={statusFor(DECISION, row.original.decision)} />
            {row.original.decided_by ? <span className="text-[13px] text-muted-foreground">By {row.original.decided_by}</span> : null}
            {row.original.decision_reason ? <span className="text-[13px] text-muted-foreground">{row.original.decision_reason}</span> : null}
          </div>
        ),
      }),
      column.display({
        id: 'po',
        header: 'Order',
        cell: ({ row }) =>
          row.original.po_no ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium tabular">{row.original.po_no}</span>
              {row.original.po_status ? <ToneBadge info={statusFor(PO_STATUS, row.original.po_status)} /> : null}
            </div>
          ) : (
            <span className="text-muted-foreground">{NO_VALUE}</span>
          ),
      }),
      column.display({ id: 'ordered', header: 'Ordered', meta: { align: 'right' }, cell: ({ row }) => qty(row.original.ordered_qty) }),
      column.display({ id: 'receivedQty', header: 'Received', meta: { align: 'right' }, cell: ({ row }) => qty(row.original.received_qty) }),
      column.display({ id: 'remaining', header: 'Remaining', meta: { align: 'right' }, cell: ({ row }) => qty(row.original.remaining_qty) }),
      column.display({
        id: 'receiving',
        header: 'Receiving',
        cell: ({ row }) =>
          row.original.line_receiving_status ? (
            <ToneBadge info={statusFor(LINE_STATUS, row.original.line_receiving_status)} />
          ) : (
            <span className="text-muted-foreground">{NO_VALUE}</span>
          ),
      }),
      column.display({ id: 'price', header: 'Unit price', meta: { align: 'right' }, cell: ({ row }) => money(row.original.unit_price_cents) }),
      column.display({ id: 'orderedCents', header: 'Ordered ₱', meta: { align: 'right' }, cell: ({ row }) => money(row.original.ordered_cents) }),
      column.display({ id: 'receivedCents', header: 'Received ₱', meta: { align: 'right' }, cell: ({ row }) => money(row.original.received_cents) }),
      column.display({
        id: 'last',
        header: 'Last received',
        cell: ({ row }) =>
          row.original.last_received_at ? (formatBranchDateTime(row.original.last_received_at, timezone) ?? row.original.last_received_at) : NO_VALUE,
      }),
    ],
    [timezone],
  );

  const footer = data
    ? { pr: 'Total', orderedCents: formatPeso(data.totals.ordered_cents), receivedCents: formatPeso(data.totals.received_cents) }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          id="purchasing-report-status"
          label="Request status"
          value={report.status}
          options={PR_STATUS_OPTIONS}
          onChange={(value) => report.setStatus(value as typeof report.status)}
        />
        <FilterSelect
          id="purchasing-report-decision"
          label="Decision"
          value={report.decision}
          options={DECISION_OPTIONS}
          onChange={(value) => report.setDecision(value as typeof report.decision)}
        />
        <FilterSelect
          id="purchasing-report-po-status"
          label="Order status"
          value={report.poStatus}
          options={PO_STATUS_OPTIONS}
          onChange={(value) => report.setPoStatus(value as typeof report.poStatus)}
        />
        <FilterSelect
          id="purchasing-report-receiving"
          label="Receiving"
          value={report.receiving}
          options={LINE_STATUS_OPTIONS}
          onChange={(value) => report.setReceiving(value as typeof report.receiving)}
        />
        {canPickSupplier ? (
          <PickerFilter label="Supplier" value={report.supplier?.name ?? null} onOpen={() => setPicker('supplier')} onClear={() => report.setSupplier(null)} />
        ) : null}
        <PickerFilter label="Item" value={report.item?.name ?? null} onOpen={() => setPicker('item')} onClear={() => report.setItem(null)} />
        {report.filtersActive ? (
          <Button variant="ghost" onClick={report.clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <ReportFrame
        query={report.query}
        hasData={data !== undefined}
        empty={
          data && data.rows.length === 0
            ? report.filtersActive
              ? { title: 'No matching purchase items', message: 'Try other filters or a longer range.' }
              : { title: 'No purchase requests in this range', message: 'Requests created in the range show here. Try a longer range.' }
            : null
        }
        truncated={result?.truncated === true}
        updating={report.updating}
        exportError={report.exportError}
        onDismissExportError={report.dismissExportError}
        noun="purchasing report"
      >
        {data ? (
          <>
            <ReportTotals totals={purchasingTotals(data.totals)} />
            <Card className="overflow-hidden">
              <DataTable
                label="Purchasing report"
                columns={columns}
                data={data.rows}
                getRowId={(row) => rowIds.get(row) ?? row.pr_no}
                footer={footer}
              />
            </Card>
          </>
        ) : null}
      </ReportFrame>
      <SupplierPickerDialog
        open={picker === 'supplier'}
        onClose={() => setPicker(null)}
        onPick={(supplier) => {
          report.setSupplier({ id: supplier.id, name: supplier.name });
          setPicker(null);
        }}
      />
      <ItemPickerDialog
        open={picker === 'item'}
        onClose={() => setPicker(null)}
        onPick={(item) => {
          report.setItem({ type: item.type, id: item.id, name: item.name });
          setPicker(null);
        }}
      />
    </div>
  );
}
