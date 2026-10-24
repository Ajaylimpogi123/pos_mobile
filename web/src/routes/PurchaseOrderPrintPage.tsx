/**
 * Purchase Request & Order PDF (v1.24 §D): `/purchasing/orders/:ulid/print`
 * (`?supplier=<id>` optional), one purchase order on A4 portrait, outside the
 * app shell. The lines are grouped by supplier, each group with the
 * supplier's details (`GET /admin/suppliers/{id}` when readable, else the
 * name only), its lines and subtotal; every group starts on a new page when
 * there are several. The toolbar's Supplier picker prints one supplier's
 * copy. Received / Remaining are left out while nothing was received.
 */
import { useParams, useSearchParams } from 'react-router';

import {
  DetailsGrid,
  NotApprovedBand,
  PrintChip,
  PrintError,
  PrintHeader,
  PrintLoading,
  PrintShell,
  PrintTotals,
  SignatureLines,
  printTd,
  printTh,
} from '@/components/purchasing/print/PrintLayout';
import {
  parseSupplierParam,
  poDate,
  printErrorProps,
  printFooterText,
  selectSupplierGroups,
  showReceivedColumns,
  type SupplierGroup,
} from '@pos/core/purchasing/printModel';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { PO_RECEIVING_STATUS, PO_STATUS, statusFor } from '@/constants/purchasingLabels';
import { usePurchaseOrder } from '@/hooks/purchasing/usePurchaseOrders';
import { useAutoPrint, useDocumentTitle, usePrintContext, useSupplierDetails, type PrintContext } from '@/hooks/purchasing/usePurchasePrint';
import { cn } from '@/lib/utils';
import type { PurchaseOrder, Supplier } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { NO_VALUE } from '@pos/core/numbers';
import { formatQty } from '@pos/core/quantity';

export function PurchaseOrderPrintPage() {
  const ulid = useParams().ulid ?? null;
  const [params, setParams] = useSearchParams();
  const detail = usePurchaseOrder(ulid);
  const context = usePrintContext();
  const selection = detail.po ? selectSupplierGroups(detail.po, parseSupplierParam(params.get('supplier'))) : null;
  const details = useSupplierDetails(selection ? selection.groups.map((group) => group.supplier.id) : []);
  const ready = detail.po !== null && context.settled && details.settled;
  useDocumentTitle(detail.po?.po_no ?? null);
  useAutoPrint(ready);

  const backTo = ulid ? `/purchasing/orders/${ulid}` : '/purchasing/orders';
  if (detail.loading || (detail.po && !ready)) return <PrintLoading label="Loading the order…" />;
  if (!detail.po || !selection) {
    const error = printErrorProps(detail.errorStatus, detail.error ?? 'Not found.', 'This order was not found.', detail.reload);
    return <PrintError {...error} backTo={backTo} backLabel="Back" />;
  }

  const allGroups = selectSupplierGroups(detail.po, null).groups;
  const picker =
    allGroups.length > 1 ? (
      <div className="flex w-64 flex-col gap-1.5">
        <Label htmlFor="po-print-supplier">Supplier</Label>
        <NativeSelect
          id="po-print-supplier"
          value={selection.only ? String(selection.only.id) : 'all'}
          onChange={(event) =>
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                if (event.target.value === 'all') next.delete('supplier');
                else next.set('supplier', event.target.value);
                return next;
              },
              { replace: true },
            )
          }
        >
          <option value="all">All suppliers</option>
          {allGroups.map((group) => (
            <option key={group.supplier.id} value={group.supplier.id}>
              {group.supplier.name}
            </option>
          ))}
        </NativeSelect>
      </div>
    ) : null;

  return (
    <PrintShell
      footer={printFooterText(context.printedAt, context.userName, detail.po.po_no)}
      backTo={backTo}
      backLabel="Back"
      ready={ready}
      toolbar={picker}
    >
      <OrderDocument po={detail.po} context={context} selection={selection} suppliers={details.suppliers} />
    </PrintShell>
  );
}

type Selection = ReturnType<typeof selectSupplierGroups>;

function OrderDocument({ po, context, selection, suppliers }: { po: PurchaseOrder; context: PrintContext; selection: Selection; suppliers: Map<number, Supplier> }) {
  const createdAt = poDate(po);
  const withReceived = showReceivedColumns(po);
  const breakGroups = selection.groups.length > 1;

  return (
    <>
      <PrintHeader
        letterhead={context.letterhead}
        title="PURCHASE ORDER"
        number={po.po_no}
        chips={
          <>
            <PrintChip>{statusFor(PO_STATUS, po.status).label}</PrintChip>
            <PrintChip>{statusFor(PO_RECEIVING_STATUS, po.receiving_status).label}</PrintChip>
          </>
        }
      />
      {po.status !== 'approved' ? (
        <NotApprovedBand text="NOT APPROVED — DO NOT SEND TO SUPPLIER" reason={po.status === 'declined' ? po.decline_reason : null} />
      ) : null}
      <DetailsGrid
        entries={[
          { label: 'PO date', value: createdAt ? (formatBranchDateTime(createdAt, context.timezone) ?? createdAt) : NO_VALUE },
          { label: 'From request', value: po.purchase_request.pr_no },
          { label: 'Created by', value: po.created_by?.name ?? NO_VALUE },
          {
            label: 'Approved by',
            value: po.approved_by
              ? `${po.approved_by.name}${po.approved_at ? ` · ${formatBranchDateTime(po.approved_at, context.timezone) ?? po.approved_at}` : ''}`
              : NO_VALUE,
          },
          { label: 'Expected delivery', value: po.expected_delivery_date ? formatBusinessDate(po.expected_delivery_date) : NO_VALUE },
          { label: 'Remarks', value: po.remarks ?? NO_VALUE, full: true },
        ]}
      />
      {selection.only ? <p className="font-semibold">Lines for {selection.only.name} only</p> : null}

      {selection.groups.map((group, index) => (
        <section key={group.supplier.id} className={cn('flex flex-col gap-2', breakGroups && index > 0 ? 'print-group-break' : null)}>
          <SupplierBlock group={group} supplier={suppliers.get(group.supplier.id) ?? null} />
          <table className="print-table" aria-label={`Lines for ${group.supplier.name}`}>
            <thead>
              <tr>
                <th className={printTh}>#</th>
                <th className={printTh}>Item</th>
                <th className={cn(printTh, 'text-right')}>Qty</th>
                <th className={printTh}>Unit</th>
                <th className={cn(printTh, 'text-right')}>Unit price</th>
                <th className={cn(printTh, 'text-right')}>Amount</th>
                {withReceived ? (
                  <>
                    <th className={cn(printTh, 'text-right')}>Received</th>
                    <th className={cn(printTh, 'text-right')}>Remaining</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {group.lines.map((line, lineIndex) => (
                <tr key={line.id}>
                  <td className={cn(printTd, 'tabular')}>{lineIndex + 1}</td>
                  <td className={printTd}>{line.item.name}</td>
                  <td className={cn(printTd, 'text-right tabular')}>{formatQty(line.qty)}</td>
                  <td className={printTd}>{line.unit}</td>
                  <td className={cn(printTd, 'text-right tabular')}>{formatPeso(line.unit_price_cents)}</td>
                  <td className={cn(printTd, 'text-right tabular')}>{formatPeso(line.line_total_cents)}</td>
                  {withReceived ? (
                    <>
                      <td className={cn(printTd, 'text-right tabular')}>{formatQty(line.received_qty)}</td>
                      <td className={cn(printTd, 'text-right tabular')}>{formatQty(line.remaining_qty)}</td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {selection.only ? null : <PrintTotals rows={[{ label: `Subtotal · ${group.supplier.name}`, value: formatPeso(group.subtotalCents) }]} />}
        </section>
      ))}

      <PrintTotals rows={[{ label: selection.only ? `Total · ${selection.only.name}` : 'Grand total', value: formatPeso(selection.totalCents), strong: true }]} />

      <SignatureLines
        entries={[
          { role: 'Prepared by', name: po.created_by?.name ?? null },
          { role: 'Approved by', name: po.approved_by?.name ?? null },
          { role: 'Received by', name: null },
        ]}
      />
    </>
  );
}

/** The supplier's name, contact person, number, email and address (name only when the record can't be read). */
function SupplierBlock({ group, supplier }: { group: SupplierGroup; supplier: Supplier | null }) {
  const lines = supplier
    ? [
        supplier.contact_person ? `Attn: ${supplier.contact_person}` : null,
        [supplier.contact_number, supplier.email].filter(Boolean).join(' · ') || null,
        supplier.address,
      ].filter((line): line is string => Boolean(line))
    : [];
  return (
    <div className="print-avoid-break border-l-4 border-green pl-3">
      <p className="text-[11px] font-semibold uppercase text-green">Supplier</p>
      <p className="text-[14px] font-bold">{supplier?.name ?? group.supplier.name}</p>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
