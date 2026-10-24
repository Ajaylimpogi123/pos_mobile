/**
 * `GET /print-config` (any signed-in user) and this terminal's receipt
 * printer: chosen per terminal among the enabled `cashier` printers and kept
 * in `localStorage` (Web POS §F); it falls back to the only enabled one, then
 * the first by name (Printing → Routing).
 */
import { useQuery } from '@tanstack/react-query';

import { chooseReceiptPrinter, receiptPrinters } from '@pos/core/printing/routing';
import { getErrorMessage } from '@/services/api';
import { getPrintConfig } from '@/services/printing';
import type { PrintConfig, Printer } from '@/services/types';
import { useTerminalStore } from '@/stores/terminal';

export const printConfigKey = ['print-config'] as const;

export function usePrintConfig() {
  const query = useQuery({
    queryKey: printConfigKey,
    queryFn: getPrintConfig,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
  });
  return {
    config: query.data ?? null,
    loading: query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export type ReceiptPrinterChoice = {
  /** The enabled receipt printers, by name. */
  options: Printer[];
  /** The printer this terminal's receipts go to, or `null` when there is none. */
  current: Printer | null;
  choose: (id: number) => void;
};

export function receiptPrinterChoice(config: PrintConfig | null, preferredId: number | null, choose: (id: number) => void): ReceiptPrinterChoice {
  const options = config ? receiptPrinters(config.printers) : [];
  return { options, current: config ? chooseReceiptPrinter(config.printers, preferredId) : null, choose };
}

export function useReceiptPrinter(config: PrintConfig | null): ReceiptPrinterChoice {
  const preferredId = useTerminalStore((state) => state.receiptPrinterId);
  const setReceiptPrinterId = useTerminalStore((state) => state.setReceiptPrinterId);
  return receiptPrinterChoice(config, preferredId, setReceiptPrinterId);
}
