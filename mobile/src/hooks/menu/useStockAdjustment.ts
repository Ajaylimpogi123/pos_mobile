import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import type { FieldErrors } from '@/hooks/forms/formErrors';
import { useIdempotentRequest } from '@/hooks/forms/useIdempotentRequest';
import { menuKeys } from '@/hooks/menu/queryKeys';
import { patchProductInLists } from '@/hooks/menu/useAdminProducts';
import { createStockAdjustment } from '@/services/adminCatalog';
import type { AdminProduct, StockAdjustmentRequest, StockMovement } from '@/services/types';
import { formatCount } from '@pos/core/numbers';

/** Add and Remove send `qty_delta` (±n); Count sends `counted_qty` (the server works out the delta). */
export type StockMode = 'add' | 'remove' | 'count';

export type StockField = 'qty' | 'reason';

/** The fields a stock adjustment's 422 can land on (`unitCost` only on a stock in). */
export type StockRequestField = StockField | 'unitCost';

/** Contract limits. */
export const STOCK_LIMITS = { maxQty: 100_000, reasonMax: 255, maxUnitCostCents: 100_000_000 } as const;

export const STOCK_UNCONFIRMED_MESSAGE = "We couldn't confirm the adjustment. Retry.";

/** A request body without its ULID (the request core adds it). */
type WithoutUlid<T> = T extends unknown ? Omit<T, 'ulid'> : never;
export type StockAdjustmentBody = WithoutUlid<StockAdjustmentRequest>;

/** `"24"` → 24; anything but 1–6 digits → `null`. */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Client-side checks mirroring the contract, then the body (without the ULID). */
export function validateStockAdjustment(
  mode: StockMode,
  qtyText: string,
  reasonText: string,
): { body: { qty_delta: number } | { counted_qty: number } | null; reason: string; errors: FieldErrors<StockField> } {
  const errors: FieldErrors<StockField> = {};
  const qty = parseWholeNumber(qtyText);
  const reason = reasonText.trim();

  if (mode === 'count') {
    if (qty === null || qty > STOCK_LIMITS.maxQty) {
      errors.qty = `Enter the counted quantity, a whole number from 0 to ${formatCount(STOCK_LIMITS.maxQty)}.`;
    }
  } else if (qty === null || qty < 1 || qty > STOCK_LIMITS.maxQty) {
    errors.qty = `Enter a whole number from 1 to ${formatCount(STOCK_LIMITS.maxQty)}.`;
  }
  if (reason === '') errors.reason = 'Enter a reason.';
  else if (reason.length > STOCK_LIMITS.reasonMax) errors.reason = `Use ${STOCK_LIMITS.reasonMax} characters or fewer.`;

  if (qty === null || errors.qty || errors.reason) return { body: null, reason, errors };
  if (mode === 'count') return { body: { counted_qty: qty }, reason, errors };
  return { body: { qty_delta: mode === 'add' ? qty : -qty }, reason, errors };
}

/** Maps a 422's API fields to the dialog's fields. */
const FIELD_OF: Record<string, StockRequestField> = {
  qty_delta: 'qty',
  counted_qty: 'qty',
  reason: 'reason',
  unit_cost_cents: 'unitCost',
};

function stockFieldOf(apiField: string): StockRequestField | null {
  return FIELD_OF[apiField] ?? null;
}

/**
 * The request core shared by every stock adjustment dialog (the menu's
 * "Adjust stock", and Inventory's Stock in, Count and Wastage): `POST
 * /admin/products/{id}/stock-adjustments`, idempotent with its **own ULID**,
 * through the shared `useIdempotentRequest` core (the ULID is kept until a
 * 201; after a network error or a timeout the body locks and Retry resends
 * it; 422s go under `qty`, `reason`, `unitCost`, anything else is a banner).
 */
export function useStockAdjustmentRequest(productId: number) {
  return useIdempotentRequest<StockAdjustmentBody, StockMovement, StockRequestField>({
    request: (key, body) => createStockAdjustment(productId, { ulid: key, ...body } as StockAdjustmentRequest),
    fieldOf: stockFieldOf,
    unconfirmedMessage: STOCK_UNCONFIRMED_MESSAGE,
  });
}

export type StockAdjustmentRequestState = ReturnType<typeof useStockAdjustmentRequest>;

/**
 * The "Adjust stock" dialog of a `track_stock` product on the menu admin
 * (permission `inventory.adjust`): Add, Remove or Count, with a required
 * reason. Sent without a `type` (the server records `adjustment`, the Phase 3
 * behaviour) through `useStockAdjustmentRequest`.
 *
 * On success the new `stock_qty` (`qty_after`) is written into the cached
 * product and product lists. 422s go under their fields.
 */
export function useStockAdjustment(product: AdminProduct) {
  const client = useQueryClient();
  const request = useStockAdjustmentRequest(product.id);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<StockMode>('add');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [localErrors, setLocalErrors] = useState<FieldErrors<StockField>>({});
  const [notice, setNotice] = useState<string | null>(null);

  function open() {
    setNotice(null);
    request.clearMessages();
    setLocalErrors({});
    // A pending ULID means the last attempt didn't succeed: keep what was typed for the retry.
    if (!request.hasPending()) {
      setMode('add');
      setQty('');
      setReason('');
    }
    setVisible(true);
  }

  function applied(movement: StockMovement) {
    const patch = { stock_qty: movement.qty_after };
    client.setQueryData<AdminProduct>(menuKeys.product(product.id), (current) => (current ? { ...current, ...patch } : current));
    patchProductInLists(client, product.id, patch);
    void client.invalidateQueries({ queryKey: menuKeys.productLists() });
    void client.invalidateQueries({ queryKey: dashboardKeys.dashboard });
  }

  async function submit() {
    if (request.isInFlight()) return;
    let body: StockAdjustmentBody | null = null;
    // While unconfirmed, sending null resends the locked body as it was.
    if (!request.unconfirmed) {
      const checked = validateStockAdjustment(mode, qty, reason);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = { ...checked.body, reason: checked.reason };
    }
    const movement = await request.send(body);
    if (!movement) return;
    applied(movement);
    setNotice(`Stock of “${product.name}” updated: ${formatCount(movement.qty_before)} → ${formatCount(movement.qty_after)}.`);
    setVisible(false);
  }

  function edit(apply: () => void, field: StockField | null) {
    apply();
    if (field) {
      setLocalErrors((current) => ({ ...current, [field]: undefined }));
      request.clearField(field);
    }
  }

  return {
    visible,
    open,
    cancel: () => {
      if (!request.isInFlight()) setVisible(false);
    },
    mode,
    setMode: (value: StockMode) => edit(() => setMode(value), 'qty'),
    qty,
    setQty: (value: string) => edit(() => setQty(value), 'qty'),
    reason,
    setReason: (value: string) => edit(() => setReason(value), 'reason'),
    fieldErrors: {
      qty: localErrors.qty ?? request.fieldErrors.qty,
      reason: localErrors.reason ?? request.fieldErrors.reason,
    } as FieldErrors<StockField>,
    banner: request.banner,
    busy: request.busy,
    /** The last attempt got no answer: the fields are locked and Save retries the same body. */
    locked: request.unconfirmed,
    notice,
    dismissNotice: () => setNotice(null),
    submit: () => void submit(),
  };
}

export type StockAdjustmentState = ReturnType<typeof useStockAdjustment>;
