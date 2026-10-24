/**
 * Sale complete (Core Sale → App → Success; Web POS §F): the **server's**
 * confirmed figures (invoice, queue number, table, total, tendered and the
 * change due in large type), then each print job's status (polled), the
 * terminal's receipt printer, **Print receipt** when auto-print is off, and
 * **New sale** (Enter).
 * Dine-in (`settlement`): the receipts only (one per share for an equal
 * split), the service charge row, and the button goes back to the tab.
 */
import { CircleCheckIcon, PrinterIcon } from 'lucide-react';

import { Banner } from '@/components/common/Banner';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { ReceiptPrinterPicker } from '@/components/printing/ReceiptPrinterPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePrintConfig, useReceiptPrinter } from '@/hooks/usePrintConfig';
import { useSaleAutoPrint } from '@/hooks/useOrderPrinting';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import type { Order } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { serviceChargeLabel } from '@pos/core/printing/documents/receipt';

type SaleCompleteDialogProps = {
  order: Order | null;
  note: string | null;
  onNewSale: () => void;
  /** Dine-in: a tab settlement (receipts only; "Done"). */
  settlement?: boolean;
};

export function SaleCompleteDialog({ order, note, onNewSale, settlement = false }: SaleCompleteDialogProps) {
  const printing = useSaleAutoPrint(order, settlement);
  const { config } = usePrintConfig();
  const receiptPrinter = useReceiptPrinter(config);

  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) {
          printing.reset();
          onNewSale();
        }
      }}
    >
      <DialogContent className="max-w-xl">
        {order ? (
          <>
            <DialogHeader className="items-center text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-green-soft">
                <CircleCheckIcon className="size-8 text-green" aria-hidden="true" />
              </span>
              <DialogTitle className="text-2xl">{settlement ? 'Bill paid' : 'Sale complete'}</DialogTitle>
              <DialogDescription>
                {order.invoice_no}
                {order.customer ? ` · ${order.customer.full_name}` : ''}
              </DialogDescription>
            </DialogHeader>

            {note ? <Banner variant="info">{note}</Banner> : null}

            <div className="grid grid-cols-2 gap-3 rounded-xl bg-subtle p-4">
              <div>
                <p className="text-[13px] text-muted-foreground">Queue</p>
                <p className="text-3xl font-bold tabular">#{order.queue_no}</p>
                {order.table_no ? <p className="text-sm font-semibold">Table {order.table_no}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-[13px] text-muted-foreground">Change due</p>
                <p className="text-[32px] leading-tight font-bold text-green tabular" aria-live="polite">
                  {formatPeso(order.change_cents)}
                </p>
              </div>
              <div className="col-span-2 flex flex-col gap-1 border-t border-border pt-3 text-[15px]">
                {order.service_charge_cents > 0 ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{serviceChargeLabel(config?.settings.service_charge_bps)}</span>
                    <span className="tabular">{formatPeso(order.service_charge_cents)}</span>
                  </div>
                ) : null}
                {order.split_count ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Split</span>
                    <span>{order.split_count} ways</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="font-bold tabular">{formatPeso(order.total_cents)}</span>
                </div>
                {order.payments.map((payment, index) => (
                  <div key={index} className="flex justify-between text-muted-foreground">
                    <span>
                      {paymentMethodLabel(payment.method)}
                      {payment.reference_no ? ` ${payment.reference_no}` : ''}
                    </span>
                    <span className="tabular">{formatPeso(payment.method === 'cash' ? (payment.tendered_cents ?? payment.amount_cents) : payment.amount_cents)}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span>Tendered</span>
                  <span className="font-semibold tabular">{formatPeso(order.tendered_cents)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Receipts print on</span>
              <ReceiptPrinterPicker choice={receiptPrinter} compact />
            </div>

            <PrintJobList tracker={printing.tracker} notices={printing.notices} unrouted={printing.unrouted} />

            {printing.manualReceipt ? (
              <Button
                variant="outline"
                onClick={() => void (settlement ? printing.printSettlementReceipt(order) : printing.printReceipt(order))}
                disabled={printing.starting}
              >
                <PrinterIcon aria-hidden="true" />
                Print receipt
              </Button>
            ) : null}

            <Button
              autoFocus
              variant="green"
              size="xl"
              className="w-full"
              onClick={() => {
                printing.reset();
                onNewSale();
              }}
            >
              {settlement ? 'Done' : 'New sale'}
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
