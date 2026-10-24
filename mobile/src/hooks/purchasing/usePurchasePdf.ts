/**
 * Purchase Request & Order PDF, revision 2 (v1.27 §G): the PDF action of the
 * PR, PO and Receiving details.
 * - `open(target)` fetches what's missing: the document (unless the screen
 *   already has it), `GET /print-config` and, on a PO when the user may read
 *   suppliers, `GET /admin/suppliers/{id}` per supplier. The last two never
 *   block (§E): the letterhead falls back to the branch name and a supplier
 *   to its name.
 * - A PO with more than one supplier first asks All suppliers or one (§D.6).
 * - The HTML comes from `@pos/core/purchasing/printHtml`; Print and Share go
 *   through `@/printing/purchasePdf`.
 * - A failed read leaves the §E message (404 / 403 / other) with Retry.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { purchaseOrderKeys, purchaseRequestKeys, supplierKeys } from '@/hooks/purchasing/queryKeys';
import { useIsOnline } from '@/hooks/useIsOnline';
import { printPdf, sharePdf } from '@/printing/purchasePdf';
import { getErrorMessage, isApiError } from '@/services/api';
import { getPrintConfig } from '@/services/printConfig';
import { getPurchaseOrder, getPurchaseRequest } from '@/services/purchasing';
import { getSupplier } from '@/services/suppliers';
import type { PrintConfig, PurchaseOrder, PurchaseRequest, Supplier } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, PURCHASE_PERMISSIONS } from '@pos/core/permissions';
import {
  groupLinesBySupplier,
  PO_NOT_FOUND_MESSAGE,
  PR_NOT_FOUND_MESSAGE,
  printErrorProps,
  type SupplierGroup,
} from '@pos/core/purchasing/printModel';
import {
  buildPrintContext,
  buildPurchaseOrderHtml,
  buildPurchaseRequestHtml,
  type PrintDocumentContext,
} from '@pos/core/purchasing/printHtml';

/** §G: offline, the PDF button is disabled with this label. */
export const PDF_OFFLINE_LABEL = 'Needs a connection';

export type PdfTarget =
  | { kind: 'pr'; ulid: string; pr?: PurchaseRequest | null }
  | { kind: 'po'; ulid: string; po?: PurchaseOrder | null };

export type PreparedPdf =
  | { kind: 'pr'; number: string; pr: PurchaseRequest; context: PrintDocumentContext }
  | { kind: 'po'; number: string; po: PurchaseOrder; context: PrintDocumentContext; suppliers: Supplier[]; groups: SupplierGroup[] };

export function pdfTargetKey(target: Pick<PdfTarget, 'kind' | 'ulid'>): string {
  return `${target.kind}-${target.ulid}`;
}

export function usePurchasePdf() {
  const client = useQueryClient();
  const online = useIsOnline();
  const user = useSessionStore((state) => state.user);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; target: PdfTarget } | null>(null);
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null);
  /** `undefined` while a multi-supplier PO still asks; `null` = All suppliers. */
  const [supplierId, setSupplierId] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = useRef(0);

  const open = useCallback(
    async (target: PdfTarget) => {
      const token = ++run.current;
      setLoadingKey(pdfTargetKey(target));
      setError(null);
      setActionError(null);

      const configRead: Promise<PrintConfig | null> = getPrintConfig().catch(() => null);
      let pr: PurchaseRequest | null = null;
      let po: PurchaseOrder | null = null;
      try {
        if (target.kind === 'pr') {
          pr =
            target.pr ??
            (await client.fetchQuery({ queryKey: purchaseRequestKeys.detail(target.ulid), queryFn: () => getPurchaseRequest(target.ulid) }));
        } else {
          po =
            target.po ??
            (await client.fetchQuery({ queryKey: purchaseOrderKeys.detail(target.ulid), queryFn: () => getPurchaseOrder(target.ulid) }));
        }
      } catch (caught) {
        if (token !== run.current) return;
        const status = isApiError(caught) ? caught.status : null;
        const notFound = target.kind === 'pr' ? PR_NOT_FOUND_MESSAGE : PO_NOT_FOUND_MESSAGE;
        setError({ message: printErrorProps(status, getErrorMessage(caught), notFound, () => undefined).message, target });
        setLoadingKey(null);
        return;
      }

      const groups = po ? groupLinesBySupplier(po.lines) : [];
      const canReadSuppliers = hasAnyPermission(user, PURCHASE_PERMISSIONS);
      const supplierReads =
        po && canReadSuppliers
          ? Promise.allSettled(
              groups.map((group) =>
                client.fetchQuery({ queryKey: supplierKeys.detail(group.supplier.id), queryFn: () => getSupplier(group.supplier.id), retry: false }),
              ),
            )
          : Promise.resolve([]);
      const [config, supplierResults] = await Promise.all([configRead, supplierReads]);
      if (token !== run.current) return;

      const context = buildPrintContext({
        config,
        fallbackBranchName: user?.branch.name ?? '',
        fallbackTimezone: user?.branch.timezone ?? '',
        userName: user?.name ?? '',
        now: Date.now(),
      });
      const suppliers = supplierResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

      setPrepared(
        pr
          ? { kind: 'pr', number: pr.pr_no, pr, context }
          : { kind: 'po', number: (po as PurchaseOrder).po_no, po: po as PurchaseOrder, context, suppliers, groups },
      );
      setSupplierId(groups.length > 1 ? undefined : null);
      setLoadingKey(null);
    },
    [client, user],
  );

  const retry = useCallback(() => {
    if (error) void open(error.target);
  }, [error, open]);

  const close = useCallback(() => {
    if (busy !== null) return;
    setPrepared(null);
    setSupplierId(undefined);
    setActionError(null);
  }, [busy]);

  const html = useMemo(() => {
    if (!prepared || supplierId === undefined) return null;
    if (prepared.kind === 'pr') return buildPurchaseRequestHtml(prepared.pr, prepared.context);
    return buildPurchaseOrderHtml(prepared.po, prepared.context, { supplierId, suppliers: prepared.suppliers });
  }, [prepared, supplierId]);

  const act = useCallback(
    async (kind: 'print' | 'share') => {
      if (!html || !prepared || busy !== null) return;
      setBusy(kind);
      setActionError(null);
      const result = kind === 'print' ? await printPdf(html) : await sharePdf(html, prepared.number);
      setBusy(null);
      if (!result.ok) setActionError(result.message);
    },
    [html, prepared, busy],
  );

  return {
    online,
    loadingKey,
    error: error?.message ?? null,
    errorKey: error ? pdfTargetKey(error.target) : null,
    retry,
    dismissError: () => setError(null),
    open: (target: PdfTarget) => void open(target),
    prepared,
    /** `undefined`: a multi-supplier PO is still asking. */
    supplierId,
    pickSupplier: (id: number | null) => {
      setActionError(null);
      setSupplierId(id);
    },
    /** Back to the supplier question (only when the PO has several suppliers). */
    changeSupplier: () => setSupplierId(undefined),
    html,
    busy,
    actionError,
    print: () => void act('print'),
    share: () => void act('share'),
    close,
  };
}

export type PurchasePdfState = ReturnType<typeof usePurchasePdf>;
