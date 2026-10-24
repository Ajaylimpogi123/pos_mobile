/**
 * Printing for one order (Web POS §F): the first prints of a completed sale,
 * **Print receipt** (auto-print off), and **Reprint** from the order detail.
 * The config is read fresh (`GET /print-config`) when a print starts, so a
 * printer change made a moment ago is used.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { printConfigKey } from '@/hooks/usePrintConfig';
import { usePrintTracker } from '@/hooks/usePrintTracker';
import type { ReceiptSettings } from '@pos/core/printing/documents/receipt';
import {
  NO_CONFIG_MESSAGE,
  planBill,
  planManualReceipt,
  planReceiptSample,
  planRefundSlip,
  planReprint,
  planSalePrint,
  planSettlementManualReceipt,
  planSettlementPrint,
  planShiftRead,
  planTabCancel,
  planTabRound,
  planTestPrint,
  planVoidPrint,
  planVoidSlipReprint,
  unroutedSentence,
  type PrintPlan,
  type ReprintKind,
} from '@/printing/printActions';
import { getPrintConfig } from '@/services/printing';
import type { Order, PrintableOrder, PrintConfig, Refund, Tab, TabItem } from '@/services/types';
import type { ShiftReadDocument } from '@pos/core/printing/documents/shiftRead';
import { useTerminalStore } from '@/stores/terminal';

export function useOrderPrinting() {
  const queryClient = useQueryClient();
  const tracker = usePrintTracker();
  const [notices, setNotices] = useState<string[]>([]);
  const [unrouted, setUnrouted] = useState<string | null>(null);
  const [manualReceipt, setManualReceipt] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadConfig = useCallback(async (): Promise<PrintConfig | null> => {
    try {
      return await queryClient.fetchQuery({ queryKey: printConfigKey, queryFn: getPrintConfig, staleTime: 10_000 });
    } catch {
      return null;
    }
  }, [queryClient]);

  const run = useCallback(
    async (makePlan: (config: PrintConfig, receiptPrinterId: number | null) => PrintPlan) => {
      setStarting(true);
      try {
        const config = await loadConfig();
        if (!config) {
          setNotices([NO_CONFIG_MESSAGE]);
          return;
        }
        let plan: PrintPlan;
        try {
          plan = makePlan(config, useTerminalStore.getState().receiptPrinterId);
        } catch {
          setNotices(["Printing couldn't start for this order. Reprint it from Order History."]);
          return;
        }
        setNotices(plan.notices);
        setUnrouted(unroutedSentence(plan.unrouted));
        setManualReceipt(plan.manualReceipt);
        await tracker.send(plan.jobs);
      } finally {
        setStarting(false);
      }
    },
    [loadConfig, tracker],
  );

  return {
    tracker,
    notices,
    unrouted,
    manualReceipt,
    starting,
    printSale: (order: PrintableOrder) => run((config, id) => planSalePrint(order, config, id)),
    printReceipt: (order: PrintableOrder) => {
      setManualReceipt(false);
      return run((config, id) => planManualReceipt(order, config, id));
    },
    reprint: (order: PrintableOrder, kind: ReprintKind) => run((config, id) => planReprint(order, config, id, kind)),
    /** After a void's 200: the void slip and the VOID kitchen tickets. */
    printVoid: (order: Order) => run((config, id) => planVoidPrint(order, config, id)),
    reprintVoidSlip: (order: Order) => run((config, id) => planVoidSlipReprint(order, config, id)),
    /** After a refund's 201 (first print), or Reprint → Refund slip. */
    printRefundSlip: (order: Order, refund: Refund, reprint: boolean) =>
      run((config, id) => planRefundSlip(order, refund, config, id, reprint)),
    /** The X-read or the Z-read of a server `Shift`. */
    printShiftRead: (doc: ShiftReadDocument, reprint: boolean) => run((config, id) => planShiftRead(doc, config, id, reprint)),
    /** Dine-in §F: a round's kitchen tickets, after its 200. */
    printTabRound: (tab: Tab, roundNo: number, roundUlid: string, serverName: string) =>
      run((config) => planTabRound(tab, roundNo, roundUlid, serverName, config)),
    /** Dine-in §F: the VOID ticket for a cancelled quantity, after its 200. */
    printTabCancel: (tab: Tab, item: TabItem, qty: number, cancelUlid: string) => run((config) => planTabCancel(tab, item, qty, cancelUlid, config)),
    /** Dine-in §F: **Print bill**. */
    printBill: (tab: Tab, splitCount: number | null) => run((config, id) => planBill(tab, config, id, splitCount, Date.now())),
    /** Dine-in: a settlement's receipts (no kitchen tickets). */
    printSettlement: (order: PrintableOrder) => run((config, id) => planSettlementPrint(order, config, id)),
    printSettlementReceipt: (order: PrintableOrder) => {
      setManualReceipt(false);
      return run((config, id) => planSettlementManualReceipt(order, config, id));
    },
    reset: () => {
      tracker.reset();
      setNotices([]);
      setUnrouted(null);
      setManualReceipt(false);
    },
  };
}

/**
 * Printers → **Test print** and Receipt settings → **Print sample**, through
 * the same queue (`kind: "test"`). Only saved printers can be tested: a job
 * needs a `printer_id`.
 */
export function useTestPrinting() {
  const queryClient = useQueryClient();
  const tracker = usePrintTracker();
  const [notice, setNotice] = useState<string | null>(null);

  async function withConfig(run: (config: PrintConfig) => void) {
    setNotice(null);
    try {
      const config = await queryClient.fetchQuery({ queryKey: printConfigKey, queryFn: getPrintConfig, staleTime: 0 });
      run(config);
    } catch {
      setNotice("The printer settings couldn't be loaded. Try again.");
    }
  }

  return {
    tracker,
    notice,
    printTest: (printerId: number) =>
      withConfig((config) => {
        const printer = config.printers.find((entry) => entry.id === printerId);
        if (!printer) {
          setNotice('This printer was not found. Refresh the list.');
          return;
        }
        void tracker.send([planTestPrint(printer, config, Date.now())]);
      }),
    printSample: (settings: ReceiptSettings) =>
      withConfig((config) => {
        const planned = planReceiptSample(config, useTerminalStore.getState().receiptPrinterId, settings, Date.now());
        if (!planned.job) {
          setNotice(planned.notice);
          return;
        }
        void tracker.send([planned.job]);
      }),
  };
}

/** Prints a completed sale once, when `order` first appears (a tab settlement: its receipts only). */
export function useSaleAutoPrint(order: PrintableOrder | null, settlement = false) {
  const printing = useOrderPrinting();
  const printed = useRef<string | null>(null);
  const { printSale, printSettlement } = printing;
  useEffect(() => {
    if (!order || printed.current === order.ulid) return;
    printed.current = order.ulid;
    void (settlement ? printSettlement(order) : printSale(order));
  }, [order, printSale, printSettlement, settlement]);
  return printing;
}
