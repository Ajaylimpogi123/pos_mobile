/**
 * Purchase Request & Order PDF (v1.24): the data and browser glue of the
 * print views.
 * - `usePrintContext`: the letterhead and timezone from `GET /print-config`
 *   (falling back to the signed-in user's branch: §E, it never blocks), the
 *   user's name and the "Printed …" time.
 * - `useSupplierDetails`: `GET /admin/suppliers/{id}` for each supplier on a
 *   PO when the user may read suppliers; any failure falls back to the name (§D/§E).
 * - `useAutoPrint`, `useDocumentTitle`: the print dialog opens once, after
 *   everything settled; the tab title becomes the PDF file name.
 */
import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { moduleByKey } from '@/constants/modules';
import { canUseModule } from '@/hooks/useModules';
import { usePrintConfig } from '@/hooks/usePrintConfig';
import { supplierKeys } from '@/hooks/useSuppliers';
import { getSupplier } from '@/services/suppliers';
import type { Supplier } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';

export type PrintContext = {
  /** The letterhead: the receipt header lines, or the branch name. */
  letterhead: string[];
  timezone: string;
  userName: string;
  /** "12 Oct 2026, 3:04 PM" in the branch's timezone. */
  printedAt: string;
  /** The print-config read finished (successfully or not). */
  settled: boolean;
};

export function usePrintContext(): PrintContext {
  const { config, loading } = usePrintConfig();
  const user = useSessionStore((state) => state.user);
  const [now] = useState(() => Date.now());
  const timezone = config?.branch.timezone ?? user?.branch.timezone ?? 'Asia/Manila';
  const headerLines = (config?.settings.receipt_header_lines ?? []).map((line) => line.trim()).filter((line) => line !== '');
  const branchName = config?.branch.name ?? user?.branch.name ?? '';
  return {
    letterhead: headerLines.length > 0 ? headerLines : branchName !== '' ? [branchName] : [],
    timezone,
    userName: user?.name ?? '',
    printedAt: formatBranchDateTime(new Date(now).toISOString(), timezone) ?? '',
    settled: !loading,
  };
}

/**
 * §D: the full supplier records (contact, number, email, address) for the
 * given ids, when the user may read suppliers. A missing entry means "name only".
 */
export function useSupplierDetails(ids: readonly number[]): { suppliers: Map<number, Supplier>; settled: boolean } {
  const user = useSessionStore((state) => state.user);
  const canRead = canUseModule(user, moduleByKey('suppliers'));
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: supplierKeys.detail(id),
      queryFn: () => getSupplier(id),
      enabled: canRead,
      retry: false,
    })),
  });
  const settled = !canRead || results.every((result) => !result.isPending);
  const suppliers = new Map<number, Supplier>();
  for (const result of results) if (result.data) suppliers.set(result.data.id, result.data);
  return { suppliers, settled };
}

/** Opens the print dialog once, when `ready` first becomes true. */
export function useAutoPrint(ready: boolean): void {
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    let fired = false;
    // A short delay lets the browser lay the page out (and load fonts) before the dialog snapshots it.
    const timer = window.setTimeout(() => {
      fired = true;
      window.print();
    }, 400);
    return () => {
      window.clearTimeout(timer);
      // Unmounted before the dialog opened (StrictMode's double run): allow the next run to open it.
      if (!fired) printed.current = false;
    };
  }, [ready]);
}

/** The tab title (Save as PDF uses it as the file name); restored on leave. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
