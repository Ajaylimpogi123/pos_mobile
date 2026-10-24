import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { useIdempotentRequest } from '@/hooks/forms/useIdempotentRequest';
import { ingredientKeys, purchaseOrderKeys } from '@/hooks/purchasing/queryKeys';
import { useAfterPurchasingWrite } from '@/hooks/purchasing/usePurchasingPermissions';
import { useUnits } from '@/hooks/units/useUnits';
import { getIngredient } from '@/services/ingredients';
import { createGoodsReceipt } from '@/services/purchasing';
import type { GoodsReceiptLineRequest, GoodsReceiptRequest, Ingredient, PurchaseLineReceivingStatus, PurchaseOrder, PurchaseOrderLine } from '@/services/types';
import { showToast } from '@/stores/toast';
import { formatQtyUnit, isWholeQty, parseQtyInput, PRODUCT_WHOLE_MESSAGE, qtyProblemMessage, toBaseQty, toScaled } from '@pos/core/quantity';
import { findUnit, itemUnitChoices, type UnitChoices } from '@pos/core/units';

/** Contract: a correction's reason is required, max 255; receipt remarks are optional (255 is a UI cap). */
export const RECEIVING_LIMITS = { reason: 255, remarks: 255 } as const;

export const RECEIPT_UNCONFIRMED_MESSAGE = "We couldn't confirm the receipt was saved. Retry: it won't be counted twice.";

/** What the user typed for one line. */
export type ReceiveEntry = {
  qty: string;
  unit: string;
  /** A correction removes quantity (sent negative) and needs a reason. */
  correction: boolean;
  reason: string;
};

export function emptyEntry(line: PurchaseOrderLine): ReceiveEntry {
  return { qty: '', unit: line.unit, correction: false, reason: '' };
}

/** The line's status for a received base quantity (§G): 0 pending, below ordered partial, equal complete, above over-received. */
export function statusForReceived(receivedBase: bigint, orderedBase: bigint): PurchaseLineReceivingStatus {
  if (receivedBase <= 0n) return 'pending';
  if (receivedBase < orderedBase) return 'partial';
  if (receivedBase === orderedBase) return 'complete';
  return 'over_received';
}

export type LineProjection = {
  /** The status after this entry (the server's current one when nothing readable is typed). */
  status: PurchaseLineReceivingStatus;
  /** The entry changes the line. */
  changed: boolean;
  /** A correction that would take the line below 0 (`Only 1 sack was received.`). */
  belowZero: string | null;
};

/**
 * The live status chip of a receive line (§L): the entered quantity converted
 * to base units with `BigInt` (`round_half_up(qty × factor, 3)`), added to (or,
 * for a correction, taken from) `received_base_qty`, then compared with the
 * line's ordered `base_qty`. The server recomputes everything on save.
 */
export function projectLine(line: PurchaseOrderLine, entry: ReceiveEntry, choices: UnitChoices | null): LineProjection {
  const unchanged: LineProjection = { status: line.receiving_status, changed: false, belowZero: null };
  const qty = parseQtyInput(entry.qty);
  const unit = choices ? findUnit(choices, entry.unit) : null;
  if (!qty.ok || !unit) return unchanged;
  const base = toScaled(toBaseQty(qty.value, unit.factor) ?? '0') ?? 0n;
  const received = toScaled(line.received_base_qty) ?? 0n;
  const next = entry.correction ? received - base : received + base;
  const ordered = toScaled(line.base_qty) ?? 0n;
  const belowZero = next < 0n ? `Only ${formatQtyUnit(line.received_qty, line.unit)} was received.` : null;
  return { status: statusForReceived(next, ordered), changed: true, belowZero };
}

type ReceiptBody = Omit<GoodsReceiptRequest, 'ulid'>;

/** Form field keys: `line-<poLineId>-qty|unit|reason`, and `remarks`. */
export type ReceiveErrors = Record<string, string | undefined>;

export function lineField(lineId: number, field: 'qty' | 'unit' | 'reason'): string {
  return `line-${lineId}-${field}`;
}

/**
 * Client-side checks (§H): at least one line; each entered line has a
 * quantity (> 0, ≤ 3 decimals) in a valid unit; a correction has a reason and
 * can't take the line below 0. Returns the body without its ULID.
 */
export function validateReceipt(
  po: PurchaseOrder,
  entries: Record<number, ReceiveEntry>,
  remarks: string,
  choicesOf: (line: PurchaseOrderLine) => UnitChoices | null,
): { body: ReceiptBody | null; errors: ReceiveErrors } {
  const errors: ReceiveErrors = {};
  const lines: GoodsReceiptLineRequest[] = [];
  for (const line of po.lines) {
    const entry = entries[line.id];
    if (!entry || (entry.qty.trim() === '' && !entry.correction)) continue;
    const qty = parseQtyInput(entry.qty);
    if (!qty.ok) errors[lineField(line.id, 'qty')] = qtyProblemMessage(qty.problem);
    else if (line.item.type === 'product' && !isWholeQty(qty.value)) errors[lineField(line.id, 'qty')] = PRODUCT_WHOLE_MESSAGE;
    const choices = choicesOf(line);
    if (!choices || !findUnit(choices, entry.unit)) errors[lineField(line.id, 'unit')] = 'Choose a unit.';
    const reason = entry.reason.trim();
    if (entry.correction) {
      if (reason === '') errors[lineField(line.id, 'reason')] = 'Give a reason for the correction.';
      else if (reason.length > RECEIVING_LIMITS.reason) errors[lineField(line.id, 'reason')] = `Use ${RECEIVING_LIMITS.reason} characters or fewer.`;
      const projected = projectLine(line, entry, choices);
      if (projected.belowZero) errors[lineField(line.id, 'qty')] = projected.belowZero;
    }
    if (qty.ok) {
      lines.push({
        po_line_id: line.id,
        qty: entry.correction ? `-${qty.value}` : qty.value,
        unit: entry.unit,
        ...(entry.correction ? { reason } : {}),
      });
    }
  }
  const trimmed = remarks.trim();
  if (trimmed.length > RECEIVING_LIMITS.remarks) errors.remarks = `Use ${RECEIVING_LIMITS.remarks} characters or fewer.`;
  if (lines.length === 0 && Object.keys(errors).length === 0) errors.form = 'Enter a quantity for at least one line.';
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { remarks: trimmed === '' ? null : trimmed, lines }, errors };
}

/**
 * The receive screen (§H, §L; `purchase.receive`): an entry per line (qty +
 * unit, a **Correction** switch with its reason), remarks, the live status
 * chips, and **Save receipt**: `POST /purchase-orders/{ulid}/receipts`,
 * idempotent with its own ULID kept until the 201. After a network error or a
 * timeout the entries lock and the button becomes **Retry** (the same body).
 * The 201's PO replaces the cached one (the receipts history updates).
 */
export function useReceiveScreen(po: PurchaseOrder | null) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const { units } = useUnits(po !== null);
  const [entries, setEntries] = useState<Record<number, ReceiveEntry>>({});
  const [remarks, setRemarks] = useState('');
  const [localErrors, setLocalErrors] = useState<ReceiveErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  // The PO line of each sent line, in order: a 422 on `lines.1.qty` lands under that line.
  const sentLineIds = useRef<number[]>([]);

  const ingredientIds = useMemo(
    () => [...new Set((po?.lines ?? []).filter((line) => line.item.type === 'ingredient').map((line) => line.item.id))],
    [po],
  );
  const ingredients = useQueries({
    queries: ingredientIds.map((id) => ({ queryKey: ingredientKeys.detail(id), queryFn: () => getIngredient(id) })),
  });
  const byId = new Map<number, Ingredient>();
  ingredients.forEach((result, index) => {
    const id = ingredientIds[index];
    if (result.data && id !== undefined) byId.set(id, result.data);
  });

  function choicesOf(line: PurchaseOrderLine): UnitChoices | null {
    if (line.item.type === 'product') return itemUnitChoices('product', null, units);
    const ingredient = byId.get(line.item.id);
    return ingredient ? itemUnitChoices('ingredient', ingredient, units) : null;
  }

  const request = useIdempotentRequest<ReceiptBody, PurchaseOrder, string>({
    request: (key, body) => createGoodsReceipt(po?.ulid ?? '', { ulid: key, ...body }),
    fieldOf: (field) => {
      if (field === 'remarks') return 'remarks';
      const match = /^lines\.(\d+)\.(qty|unit|reason)$/.exec(field);
      const lineId = match ? sentLineIds.current[Number(match[1])] : undefined;
      return match && lineId !== undefined ? lineField(lineId, match[2] as 'qty' | 'unit' | 'reason') : null;
    },
    unconfirmedMessage: RECEIPT_UNCONFIRMED_MESSAGE,
  });
  const locked = request.unconfirmed;

  function entryOf(line: PurchaseOrderLine): ReceiveEntry {
    return entries[line.id] ?? emptyEntry(line);
  }

  function clear(keys: string[]) {
    setLocalErrors((current) => {
      if (!keys.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      delete next.form;
      return next;
    });
    for (const key of keys) request.clearField(key);
  }

  function edit(line: PurchaseOrderLine, patch: Partial<ReceiveEntry>, fields: ('qty' | 'unit' | 'reason')[]) {
    if (locked) return;
    setNotice(null);
    setEntries((current) => ({ ...current, [line.id]: { ...(current[line.id] ?? emptyEntry(line)), ...patch } }));
    clear(fields.map((field) => lineField(line.id, field)));
  }

  async function submit() {
    if (!po || request.isInFlight()) return;
    let body: ReceiptBody | null = null;
    if (!request.unconfirmed) {
      const checked = validateReceipt(po, entries, remarks, choicesOf);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = checked.body;
      sentLineIds.current = checked.body.lines.map((line) => line.po_line_id);
    }
    const updated = await request.send(body);
    if (!updated) return;
    client.setQueryData(purchaseOrderKeys.detail(updated.ulid), updated);
    afterWrite({ stock: true });
    setEntries({});
    setRemarks('');
    setLocalErrors({});
    // MASTER §6: save success is a toast.
    showToast(updated.receiving_status === 'fully_received' ? 'Receipt saved. The order is fully received.' : 'Receipt saved.');
  }

  const errors: ReceiveErrors = { ...request.fieldErrors, ...localErrors };

  return {
    entryOf,
    choicesOf,
    project: (line: PurchaseOrderLine) => projectLine(line, entryOf(line), choicesOf(line)),
    setQty: (line: PurchaseOrderLine, qty: string) => edit(line, { qty }, ['qty']),
    setUnit: (line: PurchaseOrderLine, unit: string) => edit(line, { unit }, ['unit', 'qty']),
    setCorrection: (line: PurchaseOrderLine, correction: boolean) => edit(line, { correction }, ['qty', 'reason']),
    setReason: (line: PurchaseOrderLine, reason: string) => edit(line, { reason }, ['reason']),
    remarks,
    setRemarks: (text: string) => {
      if (locked) return;
      setRemarks(text);
      clear(['remarks']);
    },
    errors,
    banner: request.banner,
    notice,
    busy: request.busy,
    locked,
    submit: () => void submit(),
  };
}

export type ReceiveScreenState = ReturnType<typeof useReceiveScreen>;
