/**
 * Purchase Request & Order PDF (v1.24 §C): `/purchasing/requests/:ulid/print`,
 * one purchase request on A4 portrait, outside the app shell. Letterhead,
 * PURCHASE REQUEST with its number and status, the details, every item with
 * its estimate and decision, the totals, the signature lines and, unless
 * approved, the NOT APPROVED band. The print dialog opens once the request
 * and the print-config read have settled.
 */
import { useParams } from 'react-router';

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
import { commonApprover, itemEstimateCents, prEstimateTotals, printErrorProps, printFooterText } from '@pos/core/purchasing/printModel';
import { DECISION, PO_STATUS, PR_STATUS, statusFor } from '@/constants/purchasingLabels';
import { usePurchaseRequest } from '@/hooks/purchasing/usePurchaseRequests';
import { useAutoPrint, useDocumentTitle, usePrintContext, type PrintContext } from '@/hooks/purchasing/usePurchasePrint';
import { cn } from '@/lib/utils';
import type { PurchaseRequest } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { NO_VALUE } from '@pos/core/numbers';
import { formatQty } from '@pos/core/quantity';

export function PurchaseRequestPrintPage() {
  const ulid = useParams().ulid ?? null;
  const detail = usePurchaseRequest(ulid);
  const context = usePrintContext();
  const ready = detail.pr !== null && context.settled;
  useDocumentTitle(detail.pr?.pr_no ?? null);
  useAutoPrint(ready);

  const backTo = ulid ? `/purchasing/requests/${ulid}` : '/purchasing/requests';
  if (detail.loading || (detail.pr && !context.settled)) return <PrintLoading label="Loading the request…" />;
  if (!detail.pr) {
    const error = printErrorProps(detail.errorStatus, detail.error ?? 'Not found.', 'This request was not found.', detail.reload);
    return <PrintError {...error} backTo={backTo} backLabel="Back" />;
  }

  return (
    <PrintShell
      footer={printFooterText(context.printedAt, context.userName, detail.pr.pr_no)}
      backTo={backTo}
      backLabel="Back"
      ready={ready}
    >
      <RequestDocument pr={detail.pr} context={context} />
    </PrintShell>
  );
}

function RequestDocument({ pr, context }: { pr: PurchaseRequest; context: PrintContext }) {
  const totals = prEstimateTotals(pr.items);
  const approver = commonApprover(pr.items);
  const status = statusFor(PR_STATUS, pr.status).label;

  return (
    <>
      <PrintHeader letterhead={context.letterhead} title="PURCHASE REQUEST" number={pr.pr_no} chips={<PrintChip>{status}</PrintChip>} />
      {pr.status !== 'approved' ? <NotApprovedBand text="NOT APPROVED — FOR REVIEW ONLY" /> : null}
      <DetailsGrid
        entries={[
          { label: 'Requested by', value: pr.requested_by.name },
          { label: 'Date requested', value: formatBranchDateTime(pr.created_at, context.timezone) ?? pr.created_at },
          { label: 'Date needed', value: pr.date_needed ? formatBusinessDate(pr.date_needed) : NO_VALUE },
          { label: 'Status', value: status },
          {
            label: 'Purchase order',
            value: pr.purchase_order ? `${pr.purchase_order.po_no} · ${statusFor(PO_STATUS, pr.purchase_order.status).label}` : NO_VALUE,
          },
          ...(pr.remarks ? [{ label: 'Remarks', value: pr.remarks, full: true }] : []),
        ]}
      />

      <table className="print-table" aria-label="Requested items">
        <thead>
          <tr>
            <th className={printTh}>#</th>
            <th className={printTh}>Item</th>
            <th className={printTh}>Supplier</th>
            <th className={cn(printTh, 'text-right')}>Qty</th>
            <th className={printTh}>Unit</th>
            <th className={cn(printTh, 'text-right')}>Est. unit price</th>
            <th className={cn(printTh, 'text-right')}>Est. amount</th>
            <th className={printTh}>Decision</th>
            <th className={printTh}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {pr.items.map((item, index) => {
            const estimate = itemEstimateCents(item);
            const declined = item.decision === 'declined';
            return (
              <tr key={item.id} className={declined ? 'text-ink-muted' : undefined}>
                <td className={cn(printTd, 'tabular')}>{index + 1}</td>
                <td className={printTd}>{item.item.name}</td>
                <td className={printTd}>{item.supplier.name}</td>
                <td className={cn(printTd, 'text-right tabular')}>{formatQty(item.qty)}</td>
                <td className={printTd}>{item.unit}</td>
                <td className={cn(printTd, 'text-right tabular')}>
                  {item.estimated_unit_price_cents === null ? NO_VALUE : formatPeso(item.estimated_unit_price_cents)}
                </td>
                <td className={cn(printTd, 'text-right tabular')}>{estimate === null ? NO_VALUE : formatPeso(estimate)}</td>
                <td className={printTd}>{statusFor(DECISION, item.decision).label}</td>
                <td className={printTd}>
                  {item.remarks ?? (declined && item.decision_reason ? null : NO_VALUE)}
                  {declined && item.decision_reason ? <span className="block italic">Declined: {item.decision_reason}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <PrintTotals
        rows={[
          { label: 'Estimated total (all items)', value: totals.totalCents === null ? NO_VALUE : formatPeso(totals.totalCents) },
          { label: 'Estimated total (approved items)', value: formatPeso(totals.approvedCents), strong: true },
          ...(totals.unpricedCount > 0 ? [{ label: 'Items without a price', value: String(totals.unpricedCount) }] : []),
        ]}
      />

      <SignatureLines
        entries={[
          { role: 'Requested by', name: pr.requested_by.name },
          { role: 'Approved by', name: approver?.name ?? null },
        ]}
      />
    </>
  );
}
