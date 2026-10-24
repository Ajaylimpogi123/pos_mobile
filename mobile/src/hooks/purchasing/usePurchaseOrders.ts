import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { useIngredient } from '@/hooks/ingredients/useIngredients';
import { purchaseOrderKeys, purchaseRequestKeys } from '@/hooks/purchasing/queryKeys';
import { PURCHASE_PAGE_SIZE } from '@/hooks/purchasing/usePurchaseRequests';
import { useAfterPurchasingWrite } from '@/hooks/purchasing/usePurchasingPermissions';
import { useUnits } from '@/hooks/units/useUnits';
import { useKeyedCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { approvePurchaseOrder, declinePurchaseOrder, getPurchaseOrder, listPurchaseOrders, updatePurchaseOrder } from '@/services/purchasing';
import type {
  BusinessDate,
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

/** Contract: a decline reason is required, max 255; remarks have no stated limit (255 is a UI cap). */
export const PO_LIMITS = { reason: 255, remarks: 255 } as const;

function poKey(po: PurchaseOrder): string {
  return po.ulid;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const PO_STATUSES: readonly PurchaseOrderStatus[] = ['pending_approval', 'approved', 'declined'];

/**
 * The purchase order list (`orders`: status and receiving chips,
 * `?status=pending_approval` from the dashboard) or the Receiving list
 * (`receiving`: `to_receive`, approved and not fully received), with a search.
 */
export function usePurchaseOrderListScreen(mode: 'orders' | 'receiving') {
  const params = useLocalSearchParams<{ status?: string | string[] }>();
  const initialStatus = firstParam(params.status);
  const [status, setStatus] = useState<PurchaseOrderStatus | 'all'>(
    mode === 'orders' && PO_STATUSES.includes(initialStatus as PurchaseOrderStatus) ? (initialStatus as PurchaseOrderStatus) : 'all',
  );
  const [receiving, setReceiving] = useState<PurchaseOrderReceivingStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const online = useIsOnline();
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const query = useMemo<PurchaseOrderListParams>(
    () =>
      mode === 'receiving'
        ? { to_receive: true, search: debounced === '' ? undefined : debounced }
        : {
            search: debounced === '' ? undefined : debounced,
            status: status === 'all' ? undefined : status,
            receiving_status: receiving === 'all' ? undefined : receiving,
          },
    [mode, debounced, status, receiving],
  );

  const list = useKeyedCursorList<PurchaseOrder>({
    queryKey: purchaseOrderKeys.list(query),
    fetchPage: (cursor) => listPurchaseOrders({ ...query, per_page: PURCHASE_PAGE_SIZE, cursor }),
    keepPrevious: true,
    enabled: online,
    keyOf: poKey,
  });

  return {
    online,
    status,
    setStatus,
    receiving,
    setReceiving,
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    filtersActive: debounced !== '' || status !== 'all' || receiving !== 'all',
    clearFilters: () => {
      setSearch('');
      setStatus('all');
      setReceiving('all');
    },
    list,
  };
}

/** GET /api/v1/purchase-orders/{ulid}. */
export function usePurchaseOrder(ulid: string | null) {
  return useQuery({
    queryKey: purchaseOrderKeys.detail(ulid ?? ''),
    queryFn: () => getPurchaseOrder(ulid as string),
    enabled: ulid !== null,
  });
}

/** The valid units of a PO line's item (an ingredient's own + catalog units; a product: pc). */
export function useLineUnitChoices(line: PurchaseOrderLine | null): UnitChoices | null {
  const ingredientId = line?.item.type === 'ingredient' ? line.item.id : null;
  const ingredient = useIngredient(ingredientId);
  const { units } = useUnits(line !== null);
  return useMemo(() => {
    if (!line) return null;
    if (line.item.type === 'product') return itemUnitChoices('product', null, units);
    if (!ingredient.data) return null;
    return itemUnitChoices('ingredient', ingredient.data, units);
  }, [line, ingredient.data, units]);
}

type LineEdit = {
  line: PurchaseOrderLine;
  qty: string;
  unit: string;
  price: string;
  supplier: SupplierRef;
  errors: Partial<Record<'qty' | 'unit' | 'price' | 'supplier', string>>;
};

type DeliveryEdit = { date: BusinessDate | null; remarks: string; errors: Partial<Record<'date' | 'remarks', string>> };

function qtyText(value: string | number): string {
  const parsed = parseQtyInput(String(value), { allowZero: true });
  return parsed.ok ? parsed.value : String(value);
}

/**
 * PO actions (§G):
 * - **Approve** (`purchase.approve` + self-approval): a 422 `Set a price for
 *   every line before approving.` or a 403 shows in the banner.
 * - **Decline** with a reason (required, max 255).
 * - While pending: edit a line (qty + unit, unit price, supplier) or the
 *   delivery date and remarks (PATCH; 409 `An approved order can't be edited.`).
 * Each answer replaces the cached PO and refreshes the lists.
 */
export function usePurchaseOrderActions(po: PurchaseOrder | null) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(message);
  }

  async function run<T>(key: string, work: () => Promise<T>, onError?: (error: unknown) => boolean): Promise<T | null> {
    if (busy) return null;
    setBusy(key);
    setBanner(null);
    setNotice(null);
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
    const errors: LineEdit['errors'] = {};
    const qty = parseQtyInput(lineEdit.qty);
    if (!qty.ok) errors.qty = qtyProblemMessage(qty.problem);
    else if (line.item.type === 'product' && !isWholeQty(qty.value)) errors.qty = PRODUCT_WHOLE_MESSAGE;
    if (!findUnit(lineChoices, lineEdit.unit)) errors.unit = 'Choose a unit.';
    const price = parsePesoInput(lineEdit.price);
    if (price === null) errors.price = 'Enter the unit price in pesos, e.g. 1200.00.';
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
          const next: LineEdit['errors'] = {
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
    const updated = await run(
      'delivery',
      () => updatePurchaseOrder(po.ulid, { expected_delivery_date: delivery.date, remarks: remarks === '' ? null : remarks }),
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
    notice,
    approve: {
      visible: confirmApprove,
      open: () => setConfirmApprove(true),
      cancel: () => {
        if (!busy) setConfirmApprove(false);
      },
      confirm: () => void approve(),
    },
    decline: {
      state: decline,
      open: () => setDecline({ reason: '', error: null }),
      setReason: (reason: string) => setDecline((current) => (current ? { ...current, reason, error: null } : current)),
      submit: () => void submitDecline(),
      cancel: () => {
        if (!busy) setDecline(null);
      },
    },
    line: {
      state: lineEdit,
      choices: lineChoices,
      banner: lineBanner,
      open: (line: PurchaseOrderLine) => {
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
      cancel: () => {
        if (!busy) setLineEdit(null);
      },
    },
    delivery: {
      state: delivery,
      banner: deliveryBanner,
      open: () => {
        if (!po) return;
        setDeliveryBanner(null);
        setDelivery({ date: po.expected_delivery_date, remarks: po.remarks ?? '', errors: {} });
      },
      setDate: (date: BusinessDate | null) => setDelivery((current) => (current ? { ...current, date, errors: { ...current.errors, date: undefined } } : current)),
      setRemarks: (remarks: string) => setDelivery((current) => (current ? { ...current, remarks, errors: { ...current.errors, remarks: undefined } } : current)),
      save: () => void saveDelivery(),
      cancel: () => {
        if (!busy) setDelivery(null);
      },
    },
  };
}

export type PurchaseOrderActionsState = ReturnType<typeof usePurchaseOrderActions>;
