import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { splitSaveError, type FieldErrors } from '@/hooks/forms/formErrors';
import { inventoryKeys } from '@/hooks/inventory/queryKeys';
import { menuKeys } from '@/hooks/menu/queryKeys';
import {
  parseWholeNumber,
  STOCK_LIMITS,
  useStockAdjustmentRequest,
  type StockAdjustmentBody,
  type StockRequestField,
} from '@/hooks/menu/useStockAdjustment';
import { setReorderLevel } from '@/services/inventory';
import type { InventoryItem, StockMovement } from '@/services/types';
import { requestStockSync } from '@/sync/stockSync';
import { centsToInputText, parsePesoInput } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

/** The three Inventory dialogs (each a typed stock adjustment). */
export type StockDialogKind = 'receipt' | 'count' | 'wastage';

/** Wastage quick picks (`other` shows a text field). */
export type WastagePick = 'Spoiled' | 'Expired' | 'Damaged' | 'other';
export const WASTAGE_PICKS: readonly { value: WastagePick; label: string }[] = [
  { value: 'Spoiled', label: 'Spoiled' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Damaged', label: 'Damaged' },
  { value: 'other', label: 'Other…' },
];

/** Contract: `reorder_level` is 0–100000. */
export const REORDER_LEVEL_MAX = 100_000;

const QTY_RANGE = `a whole number from 1 to ${formatCount(STOCK_LIMITS.maxQty)}`;

type StockDialogFields = { qty: string; unitCost: string; reason: string; pick: WastagePick | null };

/** Client-side checks mirroring the contract, then the body (without the ULID). */
export function validateStockDialog(
  kind: StockDialogKind,
  fields: StockDialogFields,
): { body: StockAdjustmentBody | null; errors: FieldErrors<StockRequestField> } {
  const errors: FieldErrors<StockRequestField> = {};
  const qty = parseWholeNumber(fields.qty);
  const typed = fields.reason.trim();

  if (kind === 'count') {
    if (qty === null || qty > STOCK_LIMITS.maxQty) {
      errors.qty = `Enter the counted quantity, a whole number from 0 to ${formatCount(STOCK_LIMITS.maxQty)}.`;
    }
  } else if (qty === null || qty < 1 || qty > STOCK_LIMITS.maxQty) {
    errors.qty = `Enter ${QTY_RANGE}.`;
  }

  let reason: string | null = typed === '' ? null : typed;
  if (kind === 'wastage') {
    if (fields.pick === null) errors.reason = 'Choose a reason.';
    else if (fields.pick !== 'other') reason = fields.pick;
    else if (typed === '') errors.reason = 'Enter a reason.';
  } else if (kind === 'count' && typed === '') {
    errors.reason = 'Enter a reason.';
  }
  if (reason !== null && reason.length > STOCK_LIMITS.reasonMax) errors.reason = `Use ${STOCK_LIMITS.reasonMax} characters or fewer.`;

  let unitCost: number | undefined;
  if (kind === 'receipt' && fields.unitCost.trim() !== '') {
    const cents = parsePesoInput(fields.unitCost);
    if (cents === null || cents > STOCK_LIMITS.maxUnitCostCents) errors.unitCost = 'Enter a unit cost in pesos, e.g. 12.50.';
    else unitCost = cents;
  }

  if (qty === null || Object.keys(errors).length > 0) return { body: null, errors };
  if (kind === 'receipt') {
    return {
      body: { type: 'receipt', qty_delta: qty, reason, ...(unitCost === undefined ? {} : { unit_cost_cents: unitCost }) },
      errors,
    };
  }
  if (kind === 'count') return { body: { type: 'count', counted_qty: qty, reason: reason ?? '' }, errors };
  return { body: { type: 'wastage', qty_delta: -qty, reason: reason ?? '' }, errors };
}

/** What changed, for the success notice. */
export function stockNotice(kind: StockDialogKind, name: string, movement: StockMovement): string {
  const onHand = `${formatCount(movement.qty_after)} on hand`;
  if (kind === 'receipt') return `Received ${formatCount(movement.qty_delta)} “${name}”. ${onHand}.`;
  if (kind === 'wastage') return `Wasted ${formatCount(Math.abs(movement.qty_delta))} “${name}”. ${onHand}.`;
  return `Counted “${name}”: ${formatCount(movement.qty_before)} → ${formatCount(movement.qty_after)}.`;
}

/**
 * After any inventory write: the item, its history and every list refresh,
 * the dashboard's alerts and the admin menu's stock too, and a stock sync
 * runs so the Sell badges update.
 */
export function useAfterInventoryWrite(productId: number) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: inventoryKeys.item(productId) });
    void client.invalidateQueries({ queryKey: inventoryKeys.movements(productId) });
    void client.invalidateQueries({ queryKey: inventoryKeys.lists() });
    void client.invalidateQueries({ queryKey: dashboardKeys.dashboard });
    void client.invalidateQueries({ queryKey: menuKeys.products() });
    void requestStockSync();
  };
}

/**
 * One of the Stock in / Count / Wastage dialogs (permission `inventory.adjust`),
 * reusing the Phase 3 adjustment flow (`useStockAdjustmentRequest`): its own
 * ULID, kept until a 201; a network error shows Retry with the same body;
 * 422s under their fields. Each kind keeps its own pending ULID.
 */
export function useStockDialog(item: InventoryItem | null, kind: StockDialogKind, onApplied: (notice: string) => void) {
  const productId = item?.product_id ?? -1;
  const request = useStockAdjustmentRequest(productId);
  const afterWrite = useAfterInventoryWrite(productId);
  const [visible, setVisible] = useState(false);
  const [fields, setFields] = useState<StockDialogFields>({ qty: '', unitCost: '', reason: '', pick: null });
  const [localErrors, setLocalErrors] = useState<FieldErrors<StockRequestField>>({});

  function open() {
    if (!item) return;
    request.clearMessages();
    setLocalErrors({});
    // A pending ULID: the last attempt didn't succeed, so keep what was typed for the retry.
    if (!request.hasPending()) {
      setFields({ qty: '', unitCost: kind === 'receipt' ? centsToInputText(item.cost_cents) : '', reason: '', pick: null });
    }
    setVisible(true);
  }

  async function submit() {
    if (!item || request.isInFlight()) return;
    let body: StockAdjustmentBody | null = null;
    // Retry: sending null makes the request core resend the locked body.
    if (!request.unconfirmed) {
      const checked = validateStockDialog(kind, fields);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = checked.body;
    }
    const movement = await request.send(body);
    if (!movement) return;
    setVisible(false);
    afterWrite();
    onApplied(stockNotice(kind, item.name, movement));
  }

  function edit(patch: Partial<StockDialogFields>, field: StockRequestField) {
    setFields((current) => ({ ...current, ...patch }));
    setLocalErrors((current) => ({ ...current, [field]: undefined }));
    request.clearField(field);
  }

  const errors: FieldErrors<StockRequestField> = {
    qty: localErrors.qty ?? request.fieldErrors.qty,
    reason: localErrors.reason ?? request.fieldErrors.reason,
    unitCost: localErrors.unitCost ?? request.fieldErrors.unitCost,
  };

  return {
    kind,
    visible,
    open,
    cancel: () => {
      if (!request.isInFlight()) setVisible(false);
    },
    fields,
    setQty: (text: string) => edit({ qty: text.replace(/[^0-9]/g, '') }, 'qty'),
    setUnitCost: (text: string) => edit({ unitCost: text }, 'unitCost'),
    setReason: (text: string) => edit({ reason: text }, 'reason'),
    setPick: (pick: WastagePick) => edit({ pick }, 'reason'),
    errors,
    banner: request.banner,
    busy: request.busy,
    /** No answer to the last attempt: the fields are locked and the confirm button retries. */
    locked: request.unconfirmed,
    submit: () => void submit(),
  };
}

export type StockDialogState = ReturnType<typeof useStockDialog>;

/**
 * The reorder level dialog (`inventory.adjust`): a whole number 0–100000
 * (Save) or **Remove** (`null`, no alert). `PUT /inventory/{product}/reorder-level`
 * answers with the updated `InventoryItem`.
 */
export function useReorderLevelDialog(item: InventoryItem | null, onSaved: (notice: string) => void) {
  const client = useQueryClient();
  const productId = item?.product_id ?? -1;
  const afterWrite = useAfterInventoryWrite(productId);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);

  function open() {
    if (!item) return;
    setText(item.reorder_level === null ? '' : String(item.reorder_level));
    setError(null);
    setBanner(null);
    setVisible(true);
  }

  async function send(level: number | null) {
    if (!item || busy) return;
    setBusy(level === null ? 'remove' : 'save');
    setBanner(null);
    try {
      const updated = await setReorderLevel(item.product_id, { reorder_level: level });
      client.setQueryData(inventoryKeys.item(item.product_id), updated);
      setVisible(false);
      afterWrite();
      onSaved(
        level === null
          ? `Removed the reorder level of “${item.name}”.`
          : `Reorder level of “${item.name}” set to ${formatCount(level)}.`,
      );
    } catch (failure) {
      const split = splitSaveError(failure, ['reorder_level'] as const);
      setError(split.fieldErrors.reorder_level ?? null);
      setBanner(split.banner);
    } finally {
      setBusy(null);
    }
  }

  function save() {
    const level = parseWholeNumber(text);
    if (level === null || level > REORDER_LEVEL_MAX) {
      setError(`Enter a whole number from 0 to ${formatCount(REORDER_LEVEL_MAX)}.`);
      return;
    }
    void send(level);
  }

  return {
    visible,
    open,
    cancel: () => {
      if (!busy) setVisible(false);
    },
    text,
    setText: (value: string) => {
      setText(value.replace(/[^0-9]/g, ''));
      setError(null);
    },
    error,
    banner,
    busy,
    /** The product has a level to remove. */
    canRemove: item?.reorder_level !== null && item !== null,
    save,
    remove: () => void send(null),
  };
}

export type ReorderLevelDialogState = ReturnType<typeof useReorderLevelDialog>;
