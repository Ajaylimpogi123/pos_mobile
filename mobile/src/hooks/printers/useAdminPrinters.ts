import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { printingKeys } from '@/hooks/printers/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { createPrinter, deletePrinter, getAdminPrinter, listAdminPrinters, updatePrinter } from '@/services/printers';
import type { Printer, PrinterUpdateRequest } from '@/services/types';
import { requestPrintConfigSync } from '@/sync/printConfigSync';

/** The contract's maximum page size; a branch has at most 20 printers, so one page. */
export const PRINTER_PAGE_SIZE = 100;

/** GET /api/v1/admin/printers, every page (the form labels categories routed to other printers). */
export function useAllAdminPrinters(enabled = true) {
  const list = useCursorList({
    queryKey: printingKeys.printerList(),
    fetchPage: (cursor) => listAdminPrinters({ per_page: PRINTER_PAGE_SIZE, cursor }),
    fetchAll: true,
    enabled,
  });
  return { ...list, printers: list.items };
}

/** GET /api/v1/admin/printers/{id}. */
export function useAdminPrinter(id: number | null) {
  return useQuery({
    queryKey: printingKeys.printer(id ?? -1),
    queryFn: () => getAdminPrinter(id as number),
    enabled: id !== null,
  });
}

/**
 * Printer mutations (`settings.manage`). Every success refreshes the admin
 * printer queries and syncs the print config, so this tablet (and its
 * Printers list, which reads the cached config) routes with the change at once.
 */
export function usePrinterMutations() {
  const client = useQueryClient();

  function afterChange(printer: Printer | null) {
    if (printer) client.setQueryData(printingKeys.printer(printer.id), printer);
    // Routes and the default flag can move between printers: refresh them all.
    void client.invalidateQueries({ queryKey: printingKeys.printers() });
    void requestPrintConfigSync();
  }

  const create = useMutation({
    mutationFn: createPrinter,
    onSuccess: (printer) => afterChange(printer),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: PrinterUpdateRequest }) => updatePrinter(id, body),
    onSuccess: (printer) => afterChange(printer),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePrinter(id),
    onSuccess: () => afterChange(null),
  });

  return { create, update, remove };
}
