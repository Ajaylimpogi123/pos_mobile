/**
 * How print jobs are named on screen, e.g. "Kitchen ticket #17 didn't print:
 * Kitchen isn't responding." (docs/api-contract.md → Printing → Screens).
 */
import type { OrderItem } from '@/services/types';
import type { PrintJobView } from '@/stores/printing';

/**
 * "Receipt #17", "Receipt #17 (copy 2 of 2)", "Kitchen ticket #17", "Bar ticket #17",
 * "Void slip #17", "VOID kitchen ticket #17", "Refund slip #17", plus " (reprint)".
 */
export function jobLabel(job: Pick<PrintJobView, 'kind' | 'printerRole' | 'queueNo' | 'copyNo' | 'copies' | 'isReprint'>): string {
  const station = job.printerRole === 'bar' ? 'bar' : 'kitchen';
  let label: string;
  if (job.kind === 'x_read' || job.kind === 'z_read') {
    // Shifts & Reporting (Phase 6): the shift reports.
    label = job.kind === 'x_read' ? 'X-read' : 'Z-read';
  } else if (job.kind === 'receipt') {
    label = `Receipt #${job.queueNo}`;
    if (job.copies > 1) label += ` (copy ${job.copyNo} of ${job.copies})`;
  } else if (job.kind === 'void_slip') {
    // Voids & Refunds (Phase 7).
    label = `Void slip #${job.queueNo}`;
  } else if (job.kind === 'kitchen_void') {
    label = `VOID ${station} ticket #${job.queueNo}`;
  } else if (job.kind === 'refund_slip') {
    label = `Refund slip #${job.queueNo}`;
  } else if (job.kind === 'tab_round') {
    // Dine-in Tables & Tabs: `queueNo` is the round number.
    label = `${station === 'bar' ? 'Bar' : 'Kitchen'} ticket, round ${job.queueNo}`;
  } else if (job.kind === 'tab_void') {
    label = `VOID ${station} ticket (table bill)`;
  } else if (job.kind === 'bill') {
    label = 'Bill';
  } else {
    label = `${station === 'bar' ? 'Bar' : 'Kitchen'} ticket #${job.queueNo}`;
  }
  return job.isReprint ? `${label} (reprint)` : label;
}

/** The Sell banner's sentence for a failed job. */
export function failureSentence(job: PrintJobView): string {
  return `${jobLabel(job)} didn't print: ${job.error ?? 'The printer failed.'}`;
}

/** "2 x Rice Cake" (the "not sent to any printer" list). */
export function describeItem(item: Pick<OrderItem, 'qty' | 'product_name'>): string {
  return `${item.qty} x ${item.product_name}`;
}
