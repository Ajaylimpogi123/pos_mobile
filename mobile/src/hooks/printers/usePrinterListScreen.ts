import { useEffect, useMemo, useState } from 'react';

import { usePrinterReachability } from '@/hooks/printing/usePrinterReachability';
import { chooseReceiptPrinterForTablet, probePrinters, testPrint, type DirectPrintResult } from '@/printing/printActions';
import { chooseReceiptPrinter, sortPrinters } from '@/printing/routing';
import { getPrintTransport } from '@/printing/transport';
import { ApiError } from '@/services/api';
import type { Printer } from '@/services/types';
import { usePrintingStore } from '@/stores/printing';
import { requestPrintConfigSync } from '@/sync/printConfigSync';

export type TestPrintState = { busy: boolean; result: DirectPrintResult | null };

/** Q-005 (resolved): shown while the branch has no enabled default kitchen printer. */
export const NO_DEFAULT_KITCHEN_MESSAGE =
  'No default kitchen printer: items from categories without a printer won’t print. Edit a kitchen or bar printer and turn on “Default kitchen printer”.';

export const OFFLINE_NO_CACHE_MESSAGE =
  "This tablet is offline and hasn't downloaded the printer list yet. Connect to the network, then try again.";

/**
 * The Printers list (`sale.create` or `settings.manage`), read from the
 * **cached** print config, so it works offline. Pull-to-refresh syncs the
 * config and probes every enabled printer again. Test print results are kept
 * here, above the grid, so rotating keeps them.
 */
export function usePrinterListScreen() {
  const config = usePrintingStore((state) => state.config);
  const status = usePrintingStore((state) => state.configStatus);
  const configError = usePrintingStore((state) => state.configError);
  const receiptPrinterId = usePrintingStore((state) => state.receiptPrinterId);
  const reachability = usePrintingStore((state) => state.reachability);
  const [tests, setTests] = useState<Record<number, TestPrintState>>({});

  const printers = useMemo(() => (config ? sortPrinters(config.printers) : []), [config]);
  const enabled = useMemo(() => printers.filter((printer) => printer.is_enabled), [printers]);
  usePrinterReachability(enabled);

  // Nothing on this tablet yet and no sync has run: fetch it now.
  useEffect(() => {
    if (config === null && status === 'idle') void requestPrintConfigSync();
  }, [config, status]);

  const receiptPrinter = config ? chooseReceiptPrinter(config.printers, receiptPrinterId) : null;
  const noDefaultKitchen =
    config !== null &&
    config.settings.print_kitchen_tickets &&
    config.printers.length > 0 &&
    !config.printers.some((printer) => printer.is_default_kitchen && printer.is_enabled && printer.role !== 'cashier');
  const transport = getPrintTransport();

  let error: ApiError | null = null;
  if (config === null && status === 'offline') error = new ApiError(OFFLINE_NO_CACHE_MESSAGE, { status: null, kind: 'network' });
  else if (config === null && status === 'error') {
    error = new ApiError(configError ?? "Couldn't load the printers.", { status: null, kind: 'network' });
  }

  async function runTest(printer: Printer) {
    if (tests[printer.id]?.busy) return;
    setTests((current) => ({ ...current, [printer.id]: { busy: true, result: null } }));
    const result = await testPrint(printer);
    setTests((current) => ({ ...current, [printer.id]: { busy: false, result } }));
  }

  return {
    printers,
    reachability,
    receiptPrinterId: receiptPrinter?.id ?? null,
    /** The cached list is shown, but the last sync failed. */
    staleMessage: config !== null && status === 'error' ? configError : null,
    offline: config !== null && status === 'offline',
    /** Items from unrouted categories would print nowhere. */
    noDefaultKitchen,
    printingUnavailable: transport.available ? null : transport.unavailableMessage,
    loading: config === null && error === null,
    error,
    tests,
    retry: () => void requestPrintConfigSync(),
    refresh: async () => {
      await requestPrintConfigSync();
      await probePrinters(usePrintingStore.getState().config?.printers ?? [], { force: true });
    },
    testPrint: (printer: Printer) => void runTest(printer),
    useForReceipts: (printer: Printer) => void chooseReceiptPrinterForTablet(printer.id),
  };
}

export type PrinterListScreenState = ReturnType<typeof usePrinterListScreen>;
