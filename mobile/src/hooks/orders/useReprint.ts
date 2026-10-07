import { useRef, useState } from 'react';

import { usePrintJobs } from '@/hooks/printing/usePrintJobs';
import { printRefundSlip, reprintOrder, reprintVoidSlip, type ReprintResult } from '@/printing/printActions';
import type { Order, PrintableOrder, Refund } from '@/services/types';

const NO_JOBS: readonly string[] = [];

/** What a reprint printed: the Phase 4 documents, or (Phase 7) a void slip or a refund slip. */
export type ReprintChoice = 'receipt' | 'kitchen' | 'void_slip' | 'refund_slip';

/**
 * Order detail → Reprint (docs/api-contract.md → Printing → Screens): Receipt
 * (this tablet's receipt printer) or Kitchen tickets (every station), marked
 * `*** REPRINT ***`. Voids & Refunds (Phase 7) adds Void slip (a voided sale)
 * and Refund slip (one per refund). The chooser, the request in flight, and
 * the result (the jobs' progress, or why nothing was sent).
 */
export function useReprint(order: PrintableOrder) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ReprintResult & { kind: ReprintChoice }) | null>(null);
  const inFlight = useRef(false);
  const jobs = usePrintJobs(result?.jobIds ?? NO_JOBS);

  async function run(kind: ReprintChoice, action: () => Promise<ReprintResult>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const outcome = await action();
      setResult({ ...outcome, kind });
      setOpen(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const serverOrder = order.invoice_no !== null ? (order as Order) : null;

  return {
    open,
    busy,
    result,
    jobs,
    /** Phase 7: a voided server order offers Void slip. */
    canReprintVoidSlip: serverOrder !== null && order.status === 'voided',
    /** Phase 7: each refund offers its slip, oldest first. */
    refunds: serverOrder?.refunds ?? [],
    request: () => setOpen(true),
    cancel: () => {
      if (!inFlight.current) setOpen(false);
    },
    reprintReceipt: () => void run('receipt', () => reprintOrder(order, 'receipt')),
    reprintTickets: () => void run('kitchen', () => reprintOrder(order, 'kitchen')),
    reprintVoidSlip: () => {
      if (serverOrder) void run('void_slip', () => reprintVoidSlip(serverOrder));
    },
    reprintRefundSlip: (refund: Refund) => {
      if (serverOrder) void run('refund_slip', () => printRefundSlip(serverOrder, refund, { reprint: true }));
    },
  };
}

export type ReprintState = ReturnType<typeof useReprint>;
