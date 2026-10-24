/**
 * Ingredient inventory (Ingredients, Recipes & Purchasing §B, §D, §D1; Q-026,
 * Q-033), ported from the tablet's `mobile/src/hooks/ingredients/useIngredientStock.ts`
 * and `useIngredientCost.ts` (same rules and wording):
 * - the stock list (`GET /inventory/ingredients`: status, search, cursor,
 *   `meta.summary`), the item and its history (type filter incl. `revaluation`);
 * - the Adjust / Count / Wastage dialogs with a unit picker (`POST
 *   /admin/ingredients/{id}/stock-adjustments`, idempotent);
 * - the reorder level in any valid unit (`PUT …/reorder-level`);
 * - **Set cost** (§D1, idempotent) with the live cost-per-base-unit preview,
 *   computed exactly with `BigInt` (`costPerBaseUnit`, `stockValueCents`).
 */
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useCursorList } from '@/hooks/useCursorList';
import { useIdempotentRequest, type FieldMessages } from '@/hooks/useIdempotentRequest';
import { ingredientKeys, ingredientStockRoot, refreshIngredients } from '@/hooks/useIngredients';
import { useUnits } from '@/hooks/useRecipeBuilder';
import { getErrorMessage } from '@/services/api';
import {
  createIngredientStockAdjustment,
  getIngredientInventoryItem,
  listIngredientInventory,
  listIngredientMovements,
  setIngredientCost,
  setIngredientReorderLevel,
} from '@/services/ingredients';
import type {
  DecimalValue,
  Ingredient,
  IngredientCostRequest,
  IngredientInventoryPage,
  IngredientMovementType,
  IngredientStockAdjustmentRequest,
  IngredientStockAdjustmentResult,
  IngredientStockAdjustmentType,
  InventorySummary,
  StockStatusFilter,
} from '@/services/types';
import { splitSaveError } from '@/utils/forms';
import { formatPeso, parsePesoInput } from '@pos/core/money';
import {
  costDisplayUnit,
  costForBaseUnits,
  costPerBaseUnit,
  formatCostRate,
  formatQtyUnit,
  parseQtyInput,
  qtyProblemMessage,
  stockValueCents,
} from '@pos/core/quantity';
import { findUnit, ingredientUnitChoices, type UnitChoices } from '@pos/core/units';

import type { InventorySegment } from './useInventory';

export const INGREDIENT_STOCK_PAGE_SIZE = 25;
export const REASON_MAX = 255;

export const ingredientStockKeys = {
  all: ingredientStockRoot,
  lists: [...ingredientStockRoot, 'list'] as const,
  list: (search: string, status: StockStatusFilter | null) => [...ingredientStockRoot, 'list', search, status] as const,
  item: (id: number) => [...ingredientStockRoot, 'item', id] as const,
  movements: (id: number) => [...ingredientStockRoot, 'movements', id] as const,
  movementList: (id: number, type: IngredientMovementType | null) => [...ingredientStockRoot, 'movements', id, type] as const,
};

/** `GET /inventory/ingredients` as a cursor list, plus its branch-wide summary. */
export function useIngredientStockList(search: string, segment: InventorySegment) {
  const status: StockStatusFilter | null = segment === 'all' ? null : segment;
  const list = useCursorList<Ingredient>(ingredientStockKeys.list(search, status), (cursor) =>
    listIngredientInventory({ cursor, per_page: INGREDIENT_STOCK_PAGE_SIZE, search: search || undefined, status: status ?? undefined }),
  );
  const summary: InventorySummary | null = (list.firstPage as IngredientInventoryPage | null)?.meta.summary ?? null;
  return { list, summary };
}

function cachedIngredient(client: QueryClient, id: number): Ingredient | undefined {
  for (const [, data] of client.getQueriesData<InfiniteData<IngredientInventoryPage>>({ queryKey: ingredientStockKeys.lists })) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** `GET /inventory/ingredients/{id}`, with the list's row as placeholder. */
export function useIngredientStockItem(id: number | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ingredientStockKeys.item(id ?? -1),
    queryFn: () => getIngredientInventoryItem(id as number),
    enabled: id !== null,
    placeholderData: () => (id === null ? undefined : cachedIngredient(client, id)),
  });
  return {
    item: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** `GET /inventory/ingredients/{id}/movements` with an optional type filter. */
export function useIngredientMovements(id: number | null, type: IngredientMovementType | null) {
  return useCursorList(
    ingredientStockKeys.movementList(id ?? -1, type),
    (cursor) => listIngredientMovements(id as number, { cursor, per_page: INGREDIENT_STOCK_PAGE_SIZE, type: type ?? undefined }),
    { enabled: id !== null },
  );
}

/** The valid units of an ingredient (§A), from the catalog once it loads. */
export function useIngredientUnitChoices(ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null): UnitChoices | null {
  const { units } = useUnits(ingredient !== null);
  return useMemo(() => (ingredient ? ingredientUnitChoices(ingredient, units) : null), [ingredient, units]);
}

/** After any ingredient stock or cost write: its stock, history, the lists, its admin copy and the recipes. */
function useAfterIngredientWrite() {
  const client = useQueryClient();
  return () => refreshIngredients(client);
}

/** A stored quantity as editable text (`"5000.000"` → `"5000"`). */
function plainQty(value: DecimalValue): string {
  const parsed = parseQtyInput(String(value), { allowZero: true, allowNegative: true });
  return parsed.ok ? parsed.value : String(value);
}

// ---------------------------------------------------------------------------
// Adjust / Count / Wastage
// ---------------------------------------------------------------------------

export type IngredientStockKind = IngredientStockAdjustmentType;
export type IngredientStockField = 'qty' | 'unit' | 'reason';
type StockBody = Omit<IngredientStockAdjustmentRequest, 'ulid'>;
type StockFields = { qty: string; unit: string; direction: 'add' | 'remove'; reason: string; pick: string | null };

export const INGREDIENT_STOCK_UNCONFIRMED_MESSAGE = "We couldn't confirm the change. Retry.";

/**
 * Client-side checks (§A quantities; a reason for every type), then the body.
 * Q-026: `adjustment` sends a signed `qty`, `count` the counted quantity
 * (≥ 0), `wastage` a negative `qty`.
 */
export function validateIngredientStock(
  kind: IngredientStockKind,
  fields: StockFields,
  choices: UnitChoices,
): { body: StockBody | null; errors: FieldMessages<IngredientStockField> } {
  const errors: FieldMessages<IngredientStockField> = {};
  const allowZero = kind === 'count';
  const qty = parseQtyInput(fields.qty, { allowZero });
  if (!qty.ok) errors.qty = qtyProblemMessage(qty.problem, { allowZero });
  if (!findUnit(choices, fields.unit)) errors.unit = 'Choose a unit.';

  let reason = fields.reason.trim();
  if (kind === 'wastage' && fields.pick !== null && fields.pick !== 'other') reason = fields.pick;
  if (kind === 'wastage' && fields.pick === null) errors.reason = 'Choose a reason.';
  else if (reason === '') errors.reason = 'Enter a reason.';
  else if (reason.length > REASON_MAX) errors.reason = `Use ${REASON_MAX} characters or fewer.`;

  if (!qty.ok || Object.keys(errors).length > 0) return { body: null, errors };
  const negative = kind === 'wastage' || (kind === 'adjustment' && fields.direction === 'remove');
  return { body: { type: kind, qty: negative ? `-${qty.value}` : qty.value, unit: fields.unit, reason }, errors };
}

export function useIngredientStockDialog(item: Ingredient | null, kind: IngredientStockKind, onApplied: (notice: string) => void) {
  const id = item?.id ?? -1;
  const choices = useIngredientUnitChoices(item);
  const afterWrite = useAfterIngredientWrite();
  const request = useIdempotentRequest<StockBody, IngredientStockAdjustmentResult, IngredientStockField>({
    request: (key, body) => createIngredientStockAdjustment(id, { ulid: key, ...body }),
    fieldOf: (field) => (field === 'qty' || field === 'unit' || field === 'reason' ? field : null),
    unconfirmedMessage: INGREDIENT_STOCK_UNCONFIRMED_MESSAGE,
  });
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<StockFields>({ qty: '', unit: '', direction: 'add', reason: '', pick: null });
  const [localErrors, setLocalErrors] = useState<FieldMessages<IngredientStockField>>({});

  async function submit() {
    if (!item || !choices || request.isInFlight()) return;
    let body: StockBody | null = null;
    if (!request.unconfirmed) {
      const checked = validateIngredientStock(kind, fields, choices);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = checked.body;
    }
    const result = await request.send(body);
    if (result === null) return;
    setOpen(false);
    afterWrite();
    const entered = formatQtyUnit(fields.qty, fields.unit);
    // Q-026: the 201 carries `qty_before` / `qty_after` in base units (the server's figures).
    const before = formatQtyUnit(result.qty_before, item.base_unit);
    const onHand = `${formatQtyUnit(result.qty_after, item.base_unit)} on hand`;
    if (kind === 'count') onApplied(`Counted “${item.name}”: ${before} → ${onHand}.`);
    else if (kind === 'wastage') onApplied(`Wasted ${entered} of “${item.name}”. ${onHand}.`);
    else onApplied(`${fields.direction === 'add' ? 'Added' : 'Removed'} ${entered} of “${item.name}”. ${onHand}.`);
  }

  function edit(patch: Partial<StockFields>, field: IngredientStockField) {
    if (request.unconfirmed) return;
    setFields((current) => ({ ...current, ...patch }));
    setLocalErrors((current) => ({ ...current, [field]: undefined }));
    request.clearField(field);
  }

  return {
    kind,
    open,
    show: () => {
      if (!item) return;
      request.clearMessages();
      setLocalErrors({});
      if (!request.hasPending()) setFields({ qty: '', unit: item.base_unit, direction: 'add', reason: '', pick: null });
      setOpen(true);
    },
    close: () => {
      if (!request.isInFlight()) setOpen(false);
    },
    choices,
    fields,
    setQty: (text: string) => edit({ qty: text }, 'qty'),
    setUnit: (unit: string) => edit({ unit }, 'unit'),
    setDirection: (direction: 'add' | 'remove') => edit({ direction }, 'qty'),
    setReason: (text: string) => edit({ reason: text }, 'reason'),
    setPick: (pick: string) => edit({ pick }, 'reason'),
    errors: {
      qty: localErrors.qty ?? request.fieldErrors.qty,
      unit: localErrors.unit ?? request.fieldErrors.unit,
      reason: localErrors.reason ?? request.fieldErrors.reason,
    } as FieldMessages<IngredientStockField>,
    banner: request.banner,
    busy: request.busy,
    locked: request.unconfirmed,
    submit: () => void submit(),
  };
}

export type IngredientStockDialogState = ReturnType<typeof useIngredientStockDialog>;

// ---------------------------------------------------------------------------
// Reorder level
// ---------------------------------------------------------------------------

/** The reorder level in any valid unit (Save) or **Remove** (`null`). Q-026 body. */
export function useIngredientReorderDialog(item: Ingredient | null, onSaved: (notice: string) => void) {
  const client = useQueryClient();
  const choices = useIngredientUnitChoices(item);
  const afterWrite = useAfterIngredientWrite();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [errors, setErrors] = useState<{ qty?: string; unit?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);

  async function send(level: { qty: string; unit: string } | null) {
    if (!item || busy) return;
    setBusy(level === null ? 'remove' : 'save');
    setBanner(null);
    try {
      const updated = await setIngredientReorderLevel(item.id, { reorder_level: level });
      client.setQueryData(ingredientStockKeys.item(item.id), updated);
      client.setQueryData(ingredientKeys.detail(item.id), updated);
      setOpen(false);
      afterWrite();
      onSaved(
        level === null
          ? `Removed the reorder level of “${item.name}”.`
          : `Reorder level of “${item.name}” set to ${formatQtyUnit(level.qty, level.unit)}.`,
      );
    } catch (failure) {
      const split = splitSaveError(failure, ['reorder_level', 'reorder_level.qty', 'reorder_level.unit']);
      setErrors({
        qty: split.fieldErrors['reorder_level.qty'] ?? split.fieldErrors.reorder_level,
        unit: split.fieldErrors['reorder_level.unit'],
      });
      setBanner(split.banner);
    } finally {
      setBusy(null);
    }
  }

  return {
    open,
    show: () => {
      if (!item) return;
      setQty(item.reorder_level === null ? '' : plainQty(item.reorder_level));
      setUnit(item.base_unit);
      setErrors({});
      setBanner(null);
      setOpen(true);
    },
    close: () => {
      if (!busy) setOpen(false);
    },
    choices,
    qty,
    setQty: (text: string) => {
      setQty(text);
      setErrors((current) => ({ ...current, qty: undefined }));
    },
    unit,
    setUnit: (code: string) => {
      setUnit(code);
      setErrors((current) => ({ ...current, unit: undefined }));
    },
    errors,
    banner,
    busy,
    canRemove: item !== null && item.reorder_level !== null,
    save: () => {
      const parsed = parseQtyInput(qty, { allowZero: true });
      if (!parsed.ok) {
        setErrors({ qty: qtyProblemMessage(parsed.problem, { allowZero: true }) });
        return;
      }
      if (choices && !findUnit(choices, unit)) {
        setErrors({ unit: 'Choose a unit.' });
        return;
      }
      void send({ qty: parsed.value, unit });
    },
    remove: () => void send(null),
  };
}

export type IngredientReorderDialogState = ReturnType<typeof useIngredientReorderDialog>;

// ---------------------------------------------------------------------------
// Set cost (§D1)
// ---------------------------------------------------------------------------

/** §D1: `cost_cents` is an integer, 1 to 100,000,000 (₱1,000,000.00). */
export const COST_CENTS_MAX = 100_000_000;
export const COST_TOO_SMALL_MESSAGE = 'The cost is too small for this unit.';
export const INGREDIENT_COST_UNCONFIRMED_MESSAGE = "We couldn't confirm the new cost. Retry.";

export type IngredientCostField = 'cost_cents' | 'unit' | 'reason';
type CostFields = { amount: string; unit: string; reason: string };
type CostBody = Omit<IngredientCostRequest, 'ulid'>;

export type IngredientCostPreview = {
  /** `₱0.05 / g`. */
  perBase: string;
  /** `₱50.00 / kg` for `g` and `mL`; `null` for `pc`. */
  perLarger: string | null;
  valueFrom: number | null;
  valueTo: number | null;
  tooSmall: boolean;
};

/** `₱0.05 / g` (and `₱50.00 / kg`) for a 6-decimal cost per base unit. */
export function costRateTexts(avgCost: DecimalValue, baseUnit: string): { perBase: string; perLarger: string | null } {
  const perBase = `${formatCostRate(avgCost) ?? '—'} / ${baseUnit}`;
  const larger = costDisplayUnit(baseUnit);
  if (larger.unit === baseUnit) return { perBase, perLarger: null };
  const cents = costForBaseUnits(avgCost, larger.baseUnits);
  return { perBase, perLarger: cents === null ? null : `${formatPeso(cents)} / ${larger.unit}` };
}

function isZeroRate(avgCost: string | null): boolean {
  return avgCost !== null && /^0\.0+$/.test(avgCost);
}

/** §D1 preview with the server's math: `round_half_up(cost_cents / factor(unit), 6)`. */
export function ingredientCostPreview(
  item: Pick<Ingredient, 'base_unit' | 'qty' | 'avg_cost'>,
  fields: Pick<CostFields, 'amount' | 'unit'>,
  choices: UnitChoices,
): IngredientCostPreview | null {
  const cents = parsePesoInput(fields.amount);
  const unit = findUnit(choices, fields.unit);
  if (cents === null || cents < 1 || cents > COST_CENTS_MAX || !unit) return null;
  const avgCost = costPerBaseUnit(cents, unit.factor);
  if (avgCost === null) return null;
  return {
    ...costRateTexts(avgCost, item.base_unit),
    valueFrom: stockValueCents(item.qty, item.avg_cost),
    valueTo: stockValueCents(item.qty, avgCost),
    tooSmall: isZeroRate(avgCost),
  };
}

export function validateIngredientCost(fields: CostFields, choices: UnitChoices): { body: CostBody | null; errors: FieldMessages<IngredientCostField> } {
  const errors: FieldMessages<IngredientCostField> = {};
  const cents = parsePesoInput(fields.amount);
  const unit = findUnit(choices, fields.unit);
  if (fields.amount.trim() === '') errors.cost_cents = 'Enter the cost.';
  else if (cents === null) errors.cost_cents = 'Enter an amount in pesos, e.g. 1,250.00.';
  else if (cents < 1) errors.cost_cents = 'Enter a cost greater than ₱0.00.';
  else if (cents > COST_CENTS_MAX) errors.cost_cents = `Enter at most ${formatPeso(COST_CENTS_MAX)}.`;
  else if (unit && isZeroRate(costPerBaseUnit(cents, unit.factor))) errors.cost_cents = COST_TOO_SMALL_MESSAGE;
  if (!unit) errors.unit = 'Choose a unit.';
  const reason = fields.reason.trim();
  if (reason.length > REASON_MAX) errors.reason = `Use ${REASON_MAX} characters or fewer.`;
  if (cents === null || !unit || Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { cost_cents: cents, unit: unit.code, ...(reason === '' ? {} : { reason }) }, errors };
}

/**
 * The **Set cost** dialog (`inventory.adjust`): the price of one unit (any
 * valid unit, default the base unit), an optional reason, and the live cost
 * per base unit. Idempotent: the ULID is kept until a 2xx.
 */
export function useIngredientCostDialog(item: Ingredient | null, onSaved: (notice: string, updated: Ingredient) => void) {
  const client = useQueryClient();
  const id = item?.id ?? -1;
  const choices = useIngredientUnitChoices(item);
  const afterWrite = useAfterIngredientWrite();
  const request = useIdempotentRequest<CostBody, Ingredient, IngredientCostField>({
    request: (key, body) => setIngredientCost(id, { ulid: key, ...body }),
    fieldOf: (field) => (field === 'cost_cents' || field === 'unit' || field === 'reason' ? field : null),
    unconfirmedMessage: INGREDIENT_COST_UNCONFIRMED_MESSAGE,
  });
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<CostFields>({ amount: '', unit: '', reason: '' });
  const [localErrors, setLocalErrors] = useState<FieldMessages<IngredientCostField>>({});

  async function submit() {
    if (!item || !choices || request.isInFlight()) return;
    let body: CostBody | null = null;
    if (!request.unconfirmed) {
      const checked = validateIngredientCost(fields, choices);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = checked.body;
    }
    const updated = await request.send(body);
    if (updated === null) return;
    setOpen(false);
    client.setQueryData(ingredientStockKeys.item(updated.id), updated);
    client.setQueryData(ingredientKeys.detail(updated.id), updated);
    afterWrite();
    const rate = costRateTexts(updated.avg_cost, updated.base_unit);
    onSaved(`Cost of “${updated.name}” set: ${rate.perLarger ?? rate.perBase}.`, updated);
  }

  function edit(patch: Partial<CostFields>, field: IngredientCostField) {
    if (request.unconfirmed) return;
    setFields((current) => ({ ...current, ...patch }));
    setLocalErrors((current) => ({ ...current, [field]: undefined }));
    request.clearField(field);
  }

  return {
    open,
    show: () => {
      if (!item) return;
      request.clearMessages();
      setLocalErrors({});
      if (!request.hasPending()) setFields({ amount: '', unit: item.base_unit, reason: '' });
      setOpen(true);
    },
    close: () => {
      if (!request.isInFlight()) setOpen(false);
    },
    choices,
    fields,
    preview: item && choices ? ingredientCostPreview(item, fields, choices) : null,
    setAmount: (text: string) => edit({ amount: text }, 'cost_cents'),
    setUnit: (unit: string) => edit({ unit }, 'unit'),
    setReason: (text: string) => edit({ reason: text }, 'reason'),
    errors: {
      cost_cents: localErrors.cost_cents ?? request.fieldErrors.cost_cents,
      unit: localErrors.unit ?? request.fieldErrors.unit,
      reason: localErrors.reason ?? request.fieldErrors.reason,
    } as FieldMessages<IngredientCostField>,
    banner: request.banner,
    busy: request.busy,
    locked: request.unconfirmed,
    submit: () => void submit(),
  };
}

export type IngredientCostDialogState = ReturnType<typeof useIngredientCostDialog>;
