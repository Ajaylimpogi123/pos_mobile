/**
 * Purchase orders (§G), ported from the tablet's
 * `mobile/src/hooks/purchasing/usePurchaseOrders.ts` (same rules and wording):
 * - the list (status and receiving filters, search) and the Receiving list
 *   (`to_receive`: approved and not fully received);
 * - the detail;
 * - **Approve** (`purchase.approve` + self-approval; 422 "Set a price for
 *   every line before approving." or 403 in the banner), **Decline** with a
 *   reason, and, while pending, a line edit (qty + unit, unit price, supplier)
 *   or the delivery date and remarks (PATCH; 409 "An approved order can't be
 *   edited."). Each answer replaces the cached PO and refreshes the lists.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  PURCHASE_PAGE_SIZE,
  purchaseOrderKeys,
  purchaseRequestKeys,
  useAfterPurchasingWrite,
} from '@/hooks/purchasing/usePurchasingPermissions';
import { useCursorList } from '@/hooks/useCursorList';
import { ingredientKeys } from '@/hooks/useIngredients';
import { useUnits } from '@/hooks/useRecipeBuilder';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { getAdminIngredient } from '@/services/ingredients';
import { approvePurchaseOrder, declinePurchaseOrder, getPurchaseOrder, listPurchaseOrders, updatePurchaseOrder } from '@/services/purchasing';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderLineUpdate,
  PurchaseOrderListParams,
  PurchaseOrderReceivingStatus,
  PurchaseOrderStatus,
  SupplierRef,
} from '@/services/types';
import { centsToInputText, parsePesoInput } from '@pos/core/money';
import { isWholeQty, parseQtyInput, PRODUCT_WHOLE_MESSAGE, qtyProblemMessage, toScaled } from '@pos/core/quantity';
import { findUnit, itemUnitChoices, type UnitChoices } from '@pos/core/units';

/** Contract: a decline reason is required, max 255; Q-030: remarks max 500. */
export const PO_LIMITS = { reason: 255, remarks: 500, priceMaxCents: 100_000_000 } as const;

export const PO_STATUSES: readonly PurchaseOrderStatus[] = ['pending_approval', 'approved', 'declined'];
export const PO_RECEIVING_STATUSES: readonly PurchaseOrderReceivingStatus[] = ['not_received', 'partially_received', 'fully_received'];

export function usePurchaseOrderList(
  mode: 'orders' | 'receiving',
  search: string,
  status: PurchaseOrderStatus | 'all',
  receiving: PurchaseOrderReceivingStatus | 'all',
) {
  const params = useMemo<PurchaseOrderListParams>(
    () =>
      mode === 'receiving'
        ? { to_receive: true, search: search === '' ? undefined : search }
        : {
            search: search === '' ? undefined : search,
            status: status === 'all' ? undefined : status,
            receiving_status: receiving === 'all' ? undefined : receiving,
          },
    [mode, search, status, receiving],
  );
  return useCursorList(purchaseOrderKeys.list(params), (cursor) => listPurchaseOrders({ ...params, cursor, per_page: PURCHASE_PAGE_SIZE }));
}

/** GET /api/v1/purchase-orders/{ulid}. */
export function usePurchaseOrder(ulid: string | null) {
  const query = useQuery({
    queryKey: purchaseOrderKeys.detail(ulid ?? ''),
    queryFn: () => getPurchaseOrder(ulid as string),
    enabled: ulid !== null,
  });
  return {
    po: query.data ?? null,
    loading: ulid !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    /** The HTTP status of a failed read (404, 403…), or `null` (print views word 404 and 403 apart). */
    errorStatus: query.isError && isApiError(query.error) ? query.error.status : null,
    reload: () => void query.refetch(),
  };
}

/** The valid units of a PO line's item (an ingredient's own + catalog units; a product: pc). */
export function useLineUnitChoices(line: PurchaseOrderLine | null): UnitChoices | null {
  const ingredientId = line?.item.type === 'ingredient' ? line.item.id : null;
  const ingredient = useQuery({
    queryKey: ingredientKeys.detail(ingredientId ?? 0),
    queryFn: () => getAdminIngredient(ingredientId as number),
    enabled: ingredientId !== null,
  });
  const { units } = useUnits(line !== null);
  return useMemo(() => {
    if (!line) return null;
    if (line.item.type === 'product') return itemUnitChoices('product', null, units);
    if (!ingredient.data) return null;
    return itemUnitChoices('ingredient', ingredient.data, units);
  }, [line, ingredient.data, units]);
}

type LineErrors = Partial<Record<'qty' | 'unit' | 'price' | 'supplier', string>>;
type LineEdit = { line: PurchaseOrderLine; qty: string; unit: string; price: string; supplier: SupplierRef; errors: LineErrors };
type DeliveryEdit = { date: string; remarks: string; errors: Partial<Record<'date' | 'remarks', string>> };

function qtyText(value: string | number): string {
  const parsed = parseQtyInput(String(value), { allowZero: true });
  return parsed.ok ? parsed.value : String(value);
}

export function usePurchaseOrderActions(po: PurchaseOrder | null) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [decline, setDecline] = useState<{ reason: string; error: string | null } | null>(null);
  const [lineEdit, setLineEdit] = useState<LineEdit | null>(null);
  const [lineBanner, setLineBanner] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryEdit | null>(null);
  const [deliveryBanner, setDeliveryBanner] = useState<string | null>(null);
  const lineChoices = useLineUnitChoices(lineEdit?.line ?? null);

  function applied(updated: PurchaseOrder, message: string) {
    client.setQueryData(purchaseOrderKeys.detail(updated.ulid), updated);
    void client.invalidateQueries({ queryKey: purchaseRequestKeys.detail(updated.purchase_request.ulid) });
    afterWrite();
    // MASTER §6: a save success is a toast.
    toast.success(message);
  }

  async function run<T>(key: string, work: () => Promise<T>, onError?: (error: unknown) => boolean): Promise<T | null> {
    if (busy) return null;
    setBusy(key);
    setBanner(null);
    try {
      return await work();
    } catch (error) {
      if (!onError?.(error)) setBanner(getErrorMessage(error));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!po) return;
    const updated = await run('approve', () => approvePurchaseOrder(po.ulid));
    setConfirmApprove(false);
    if (updated) applied(updated, `${updated.po_no} is approved and ready for receiving.`);
  }

  async function submitDecline() {
    if (!po || !decline) return;
    const reason = decline.reason.trim();
    if (reason === '') return setDecline({ ...decline, error: 'Give a reason for declining.' });
    if (reason.length > PO_LIMITS.reason) return setDecline({ ...decline, error: `Use ${PO_LIMITS.reason} characters or fewer.` });
    const updated = await run(
      'decline',
      () => declinePurchaseOrder(po.ulid, { reason }),
      (error) => {
        if (isApiValidationError(error) && error.firstError('reason')) {
          setDecline({ ...decline, error: error.firstError('reason') });
          return true;
        }
        return false;
      },
    );
    if (updated) {
      setDecline(null);
      applied(updated, `${updated.po_no} was declined.`);
    }
  }

  async function saveLine() {
    if (!po || !lineEdit || !lineChoices) return;
    const { line } = lineEdit;
    const errors: LineErrors = {};
    const qty = parseQtyInput(lineEdit.qty);
    if (!qty.ok) errors.qty = qtyProblemMessage(qty.problem);
    else if (line.item.type === 'product' && !isWholeQty(qty.value)) errors.qty = PRODUCT_WHOLE_MESSAGE;
    if (!findUnit(lineChoices, lineEdit.unit)) errors.unit = 'Choose a unit.';
    const price = parsePesoInput(lineEdit.price);
    if (price === null || price > PO_LIMITS.priceMaxCents) errors.price = 'Enter the unit price in pesos, e.g. 1200.00.';
    if (Object.keys(errors).length > 0 || !qty.ok || price === null) {
      setLineEdit({ ...lineEdit, errors });
      return;
    }
    const change: PurchaseOrderLineUpdate = { id: line.id };
    if (toScaled(qty.value) !== toScaled(line.qty)) change.qty = qty.value;
    if (lineEdit.unit !== line.unit) change.unit = lineEdit.unit;
    if (price !== line.unit_price_cents) change.unit_price_cents = price;
    if (lineEdit.supplier.id !== line.supplier.id) change.supplier_id = lineEdit.supplier.id;
    if (Object.keys(change).length === 1) {
      setLineEdit(null);
      return;
    }
    setLineBanner(null);
    const updated = await run(
      'line',
      () => updatePurchaseOrder(po.ulid, { lines: [change] }),
      (error) => {
        if (isApiValidationError(error)) {
          const next: LineErrors = {
            qty: error.firstError('lines.0.qty') ?? undefined,
            unit: error.firstError('lines.0.unit') ?? undefined,
            price: error.firstError('lines.0.unit_price_cents') ?? undefined,
            supplier: error.firstError('lines.0.supplier_id') ?? undefined,
          };
          const any = Object.values(next).some(Boolean);
          setLineEdit({ ...lineEdit, errors: next });
          setLineBanner(any ? null : error.message);
          return true;
        }
        setLineBanner(getErrorMessage(error));
        return true;
      },
    );
    if (updated) {
      setLineEdit(null);
      applied(updated, `Updated “${line.item.name}”.`);
    }
  }

  async function saveDelivery() {
    if (!po || !delivery) return;
    const remarks = delivery.remarks.trim();
    if (remarks.length > PO_LIMITS.remarks) {
      setDelivery({ ...delivery, errors: { remarks: `Use ${PO_LIMITS.remarks} characters or fewer.` } });
      return;
    }
    setDeliveryBanner(null);
    const date = delivery.date.trim();
    const updated = await run(
      'delivery',
      () => updatePurchaseOrder(po.ulid, { expected_delivery_date: date === '' ? null : date, remarks: remarks === '' ? null : remarks }),
      (error) => {
        if (isApiValidationError(error)) {
          const next = { date: error.firstError('expected_delivery_date') ?? undefined, remarks: error.firstError('remarks') ?? undefined };
          setDelivery({ ...delivery, errors: next });
          setDeliveryBanner(next.date || next.remarks ? null : error.message);
          return true;
        }
        setDeliveryBanner(getErrorMessage(error));
        return true;
      },
    );
    if (updated) {
      setDelivery(null);
      applied(updated, 'Delivery details saved.');
    }
  }

  return {
    busy,
    banner,
    approve: {
      open: confirmApprove,
      show: () => setConfirmApprove(true),
      close: () => {
        if (!busy) setConfirmApprove(false);
      },
      confirm: () => void approve(),
    },
    decline: {
      state: decline,
      show: () => setDecline({ reason: '', error: null }),
      setReason: (reason: string) => setDecline((current) => (current ? { ...current, reason, error: null } : current)),
      submit: () => void submitDecline(),
      close: () => {
        if (!busy) setDecline(null);
      },
    },
    line: {
      state: lineEdit,
      choices: lineChoices,
      banner: lineBanner,
      show: (line: PurchaseOrderLine) => {
        setLineBanner(null);
        setLineEdit({ line, qty: qtyText(line.qty), unit: line.unit, price: centsToInputText(line.unit_price_cents), supplier: line.supplier, errors: {} });
      },
      set: (patch: Partial<Omit<LineEdit, 'line' | 'errors'>>) =>
        setLineEdit((current) => {
          if (!current) return current;
          const cleared = { ...current.errors };
          for (const key of Object.keys(patch) as (keyof typeof patch)[]) delete cleared[key];
          return { ...current, ...patch, errors: cleared };
        }),
      save: () => void saveLine(),
      close: () => {
        if (!busy) setLineEdit(null);
      },
    },
    delivery: {
      state: delivery,
      banner: deliveryBanner,
      show: () => {
        if (!po) return;
        setDeliveryBanner(null);
        setDelivery({ date: po.expected_delivery_date ?? '', remarks: po.remarks ?? '', errors: {} });
      },
      setDate: (date: string) => setDelivery((current) => (current ? { ...current, date, errors: { ...current.errors, date: undefined } } : current)),
      setRemarks: (remarks: string) =>
        setDelivery((current) => (current ? { ...current, remarks, errors: { ...current.errors, remarks: undefined } } : current)),
      save: () => void saveDelivery(),
      close: () => {
        if (!busy) setDelivery(null);
      },
    },
  };
}

export type PurchaseOrderActionsState = ReturnType<typeof usePurchaseOrderActions>;
