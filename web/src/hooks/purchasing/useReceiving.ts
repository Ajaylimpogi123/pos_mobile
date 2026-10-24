/**
 * Receiving (§H, §L), ported from the tablet's
 * `mobile/src/hooks/purchasing/useReceiving.ts` (same rules and wording): an
 * entry per PO line (qty + unit, a **Correction** switch with its reason),
 * remarks, a live status per line (the entered quantity converted to base
 * units with `BigInt`, added to or taken from `received_base_qty`, compared
 * with the ordered `base_qty`; Over-received is a caution), and **Save
 * receipt**: `POST /purchase-orders/{ulid}/receipts`, idempotent with its own
 * ULID kept until the 201. After a network error or a timeout the entries lock
 * and the button becomes **Retry** (the same body). A 422 on `lines.1.qty`
 * lands under that line.
 */
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { purchaseOrderKeys, useAfterPurchasingWrite } from '@/hooks/purchasing/usePurchasingPermissions';
import { useIdempotentRequest } from '@/hooks/useIdempotentRequest';
import { ingredientKeys } from '@/hooks/useIngredients';
import { useUnits } from '@/hooks/useRecipeBuilder';
import { getAdminIngredient } from '@/services/ingredients';
import { createGoodsReceipt } from '@/services/purchasing';
import type { GoodsReceiptLineRequest, GoodsReceiptRequest, Ingredient, PurchaseLineReceivingStatus, PurchaseOrder, PurchaseOrderLine } from '@/services/types';
import {
  decimalParts,
  divRoundHalfUp,
  formatQtyUnit,
  isWholeQty,
  parseQtyInput,
  PRODUCT_WHOLE_MESSAGE,
  qtyProblemMessage,
  toBaseQty,
  toScaled,
} from '@pos/core/quantity';
import { findUnit, itemUnitChoices, type UnitChoices } from '@pos/core/units';

/** A correction's reason is required, max 255; Q-030: remarks max 500. */
export const RECEIVING_LIMITS = { reason: 255, remarks: 500 } as const;

export const RECEIPT_UNCONFIRMED_MESSAGE = "We couldn't confirm the receipt was saved. Retry: it won't be counted twice.";

export type ReceiveEntry = { qty: string; unit: string; correction: boolean; reason: string };

function emptyEntry(line: PurchaseOrderLine): ReceiveEntry {
  return { qty: '', unit: line.unit, correction: false, reason: '' };
}

/** The line's status for a received base quantity (§G). */
export function statusForReceived(receivedBase: bigint, orderedBase: bigint): PurchaseLineReceivingStatus {
  if (receivedBase <= 0n) return 'pending';
  if (receivedBase < orderedBase) return 'partial';
  if (receivedBase === orderedBase) return 'complete';
  return 'over_received';
}

export type LineProjection = {
  status: PurchaseLineReceivingStatus;
  changed: boolean;
  /** A correction that would take the line below 0 (`Only 1 sack was received.`). */
  belowZero: string | null;
};

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

/**
 * The cost this entry records (§H, Q-030 #7): `round_half_up(unit_price_cents
 * × base_qty / factor(line unit), 0)` with the line unit's exact factor,
 * negative for a correction; `null` until the entry is readable.
 */
export function entryCostCents(line: PurchaseOrderLine, entry: ReceiveEntry, choices: UnitChoices | null): number | null {
  if (!choices) return null;
  const qty = parseQtyInput(entry.qty);
  const unit = findUnit(choices, entry.unit);
  const lineUnit = findUnit(choices, line.unit);
  if (!qty.ok || !unit || !lineUnit || !Number.isSafeInteger(line.unit_price_cents)) return null;
  const base = decimalParts(toBaseQty(qty.value, unit.factor) ?? '');
  const factor = decimalParts(lineUnit.factor);
  if (!base || !factor || factor.digits <= 0n) return null;
  const numerator = BigInt(line.unit_price_cents) * base.digits * 10n ** BigInt(factor.scale);
  const denominator = factor.digits * 10n ** BigInt(base.scale);
  const cents = Number(divRoundHalfUp(numerator, denominator));
  return entry.correction ? -cents : cents;
}

type ReceiptBody = Omit<GoodsReceiptRequest, 'ulid'>;
export type ReceiveErrors = Record<string, string | undefined>;

export function lineField(lineId: number, field: 'qty' | 'unit' | 'reason'): string {
  return `line-${lineId}-${field}`;
}

function validateReceipt(
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
      lines.push({ po_line_id: line.id, qty: entry.correction ? `-${qty.value}` : qty.value, unit: entry.unit, ...(entry.correction ? { reason } : {}) });
    }
  }
  const trimmed = remarks.trim();
  if (trimmed.length > RECEIVING_LIMITS.remarks) errors.remarks = `Use ${RECEIVING_LIMITS.remarks} characters or fewer.`;
  if (lines.length === 0 && Object.keys(errors).length === 0) errors.form = 'Enter a quantity for at least one line.';
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { remarks: trimmed === '' ? null : trimmed, lines }, errors };
}

export function useReceiveForm(po: PurchaseOrder | null) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const { units } = useUnits(po !== null);
  const [entries, setEntries] = useState<Record<number, ReceiveEntry>>({});
  const [remarks, setRemarks] = useState('');
  const [localErrors, setLocalErrors] = useState<ReceiveErrors>({});
  // The PO line of each sent line, in order: a 422 on `lines.1.qty` lands under that line.
  const sentLineIds = useRef<number[]>([]);

  const ingredientIds = useMemo(
    () => [...new Set((po?.lines ?? []).filter((line) => line.item.type === 'ingredient').map((line) => line.item.id))],
    [po],
  );
  const ingredients = useQueries({
    queries: ingredientIds.map((id) => ({ queryKey: ingredientKeys.detail(id), queryFn: () => getAdminIngredient(id) })),
  });
  const byId = new Map<number, Ingredient>();
  ingredients.forEach((result, index) => {
    const id = ingredientIds[index];
    if (result.data && id !== undefined) byId.set(id, result.data);
  });
  const unitsFailed = ingredients.some((result) => result.isError);

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
      const next = { ...current };
      for (const key of keys) delete next[key];
      delete next.form;
      return next;
    });
    for (const key of keys) request.clearField(key);
  }

  function edit(line: PurchaseOrderLine, patch: Partial<ReceiveEntry>, fields: ('qty' | 'unit' | 'reason')[]) {
    if (locked) return;
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
    // MASTER §6: a save success is a toast.
    toast.success(updated.receiving_status === 'fully_received' ? 'Receipt saved. The order is fully received.' : 'Receipt saved.');
  }

  return {
    entryOf,
    choicesOf,
    unitsFailed,
    project: (line: PurchaseOrderLine) => projectLine(line, entryOf(line), choicesOf(line)),
    costOf: (line: PurchaseOrderLine) => entryCostCents(line, entryOf(line), choicesOf(line)),
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
    errors: { ...request.fieldErrors, ...localErrors } as ReceiveErrors,
    banner: request.banner,
    busy: request.busy,
    locked,
    submit: () => void submit(),
  };
}

export type ReceiveFormState = ReturnType<typeof useReceiveForm>;
