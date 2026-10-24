import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { FieldErrors } from '@/hooks/forms/formErrors';
import { useIdempotentRequest } from '@/hooks/forms/useIdempotentRequest';
import { REASON_MAX, useAfterIngredientStockWrite, useIngredientUnitChoices } from '@/hooks/ingredients/useIngredientStock';
import { menuKeys } from '@/hooks/menu/queryKeys';
import { ingredientKeys, ingredientStockKeys } from '@/hooks/purchasing/queryKeys';
import { setIngredientCost } from '@/services/ingredients';
import type { DecimalValue, Ingredient, IngredientCostRequest } from '@/services/types';
import { formatPeso, parsePesoInput } from '@pos/core/money';
import { costDisplayUnit, costForBaseUnits, costPerBaseUnit, formatCostRate, stockValueCents } from '@pos/core/quantity';
import { findUnit, type UnitChoices } from '@pos/core/units';

/** §D1: `cost_cents` is an integer, 1 to 100,000,000 (₱1,000,000.00). */
export const COST_CENTS_MAX = 100_000_000;

/** §D1 wording when the cost per base unit rounds to 0. */
export const COST_TOO_SMALL_MESSAGE = 'The cost is too small for this unit.';

export const INGREDIENT_COST_UNCONFIRMED_MESSAGE = "We couldn't confirm the new cost. Retry.";

export type IngredientCostField = 'cost_cents' | 'unit' | 'reason';

export type IngredientCostFields = { amount: string; unit: string; reason: string };

type CostBody = Omit<IngredientCostRequest, 'ulid'>;

const COST_FIELD_OF: Record<string, IngredientCostField> = { cost_cents: 'cost_cents', unit: 'unit', reason: 'reason' };

function costFieldOf(apiField: string): IngredientCostField | null {
  return COST_FIELD_OF[apiField] ?? null;
}

/** The live preview: the new cost per base unit (and per kg / L), and the stock value it gives. */
export type IngredientCostPreview = {
  /** 6-decimal centavos per base unit, as the server computes it (`"5.000000"`). */
  avgCost: string;
  /** `₱0.05 / g`. */
  perBase: string;
  /** `₱50.00 / kg` for `g` and `mL`; `null` for `pc`. */
  perLarger: string | null;
  /** Stock value now and at the new cost (integer centavos), or `null` when unreadable. */
  valueFrom: number | null;
  valueTo: number | null;
  /** `true` when the cost per base unit rounds to 0 (the server answers 422). */
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

/**
 * §D1 preview with the server's math (`BigInt`):
 * `round_half_up(cost_cents / factor(unit), 6)`. `null` until the amount and
 * the unit are readable.
 */
export function ingredientCostPreview(
  item: Pick<Ingredient, 'base_unit' | 'qty' | 'avg_cost'>,
  fields: Pick<IngredientCostFields, 'amount' | 'unit'>,
  choices: UnitChoices,
): IngredientCostPreview | null {
  const cents = parsePesoInput(fields.amount);
  const unit = findUnit(choices, fields.unit);
  if (cents === null || cents < 1 || cents > COST_CENTS_MAX || !unit) return null;
  const avgCost = costPerBaseUnit(cents, unit.factor);
  if (avgCost === null) return null;
  const tooSmall = /^0\.0+$/.test(avgCost);
  return {
    avgCost,
    ...costRateTexts(avgCost, item.base_unit),
    valueFrom: stockValueCents(item.qty, item.avg_cost),
    valueTo: stockValueCents(item.qty, avgCost),
    tooSmall,
  };
}

/** Client-side checks (§D1), then the body without its ULID. */
export function validateIngredientCost(
  fields: IngredientCostFields,
  choices: UnitChoices,
): { body: CostBody | null; errors: FieldErrors<IngredientCostField> } {
  const errors: FieldErrors<IngredientCostField> = {};
  const cents = parsePesoInput(fields.amount);
  const unit = findUnit(choices, fields.unit);
  if (fields.amount.trim() === '') errors.cost_cents = 'Enter the cost.';
  else if (cents === null) errors.cost_cents = 'Enter an amount in pesos, e.g. 1,250.00.';
  else if (cents < 1) errors.cost_cents = 'Enter a cost greater than ₱0.00.';
  else if (cents > COST_CENTS_MAX) errors.cost_cents = `Enter at most ${formatPeso(COST_CENTS_MAX)}.`;
  else if (unit && /^0\.0+$/.test(costPerBaseUnit(cents, unit.factor) ?? '')) errors.cost_cents = COST_TOO_SMALL_MESSAGE;
  if (!unit) errors.unit = 'Choose a unit.';
  const reason = fields.reason.trim();
  if (reason.length > REASON_MAX) errors.reason = `Use ${REASON_MAX} characters or fewer.`;

  if (cents === null || !unit || Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { cost_cents: cents, unit: unit.code, ...(reason === '' ? {} : { reason }) }, errors };
}

/**
 * After a cost is set: the ingredient's stock, history, lists and admin copy,
 * and every recipe (their line costs and cost per serving use `avg_cost`).
 */
export function useAfterIngredientCostWrite(id: number) {
  const client = useQueryClient();
  const afterStockWrite = useAfterIngredientStockWrite(id);
  return (updated: Ingredient) => {
    client.setQueryData(ingredientStockKeys.item(id), updated);
    afterStockWrite();
    void client.invalidateQueries({ queryKey: ingredientKeys.all });
    void client.invalidateQueries({ queryKey: menuKeys.recipes() });
  };
}

/**
 * The **Set cost** dialog (§D1, `inventory.adjust`): the price in pesos of
 * one unit (any valid unit, default the base unit), an optional reason, and
 * the live cost per base unit. On the shared idempotent core: the ULID is kept
 * until a 2xx; a network error locks the body and the button becomes
 * **Retry** (same body, same ULID); 422s go under `cost_cents`, `unit`, `reason`.
 */
export function useIngredientCostDialog(item: Ingredient | null, onSaved: (notice: string, updated: Ingredient) => void) {
  const id = item?.id ?? -1;
  const choices = useIngredientUnitChoices(item);
  const afterWrite = useAfterIngredientCostWrite(id);
  const request = useIdempotentRequest<CostBody, Ingredient, IngredientCostField>({
    request: (key, body) => setIngredientCost(id, { ulid: key, ...body }),
    fieldOf: costFieldOf,
    unconfirmedMessage: INGREDIENT_COST_UNCONFIRMED_MESSAGE,
  });
  const [visible, setVisible] = useState(false);
  const [fields, setFields] = useState<IngredientCostFields>({ amount: '', unit: '', reason: '' });
  const [localErrors, setLocalErrors] = useState<FieldErrors<IngredientCostField>>({});

  function open() {
    if (!item) return;
    request.clearMessages();
    setLocalErrors({});
    // A pending ULID: the last attempt didn't succeed, so keep what was typed for the retry.
    if (!request.hasPending()) setFields({ amount: '', unit: item.base_unit, reason: '' });
    setVisible(true);
  }

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
    setVisible(false);
    afterWrite(updated);
    const rate = costRateTexts(updated.avg_cost, updated.base_unit);
    onSaved(`Cost of “${updated.name}” set: ${rate.perLarger ?? rate.perBase}.`, updated);
  }

  function edit(patch: Partial<IngredientCostFields>, field: IngredientCostField) {
    setFields((current) => ({ ...current, ...patch }));
    setLocalErrors((current) => ({ ...current, [field]: undefined }));
    request.clearField(field);
  }

  return {
    visible,
    open,
    cancel: () => {
      if (!request.isInFlight()) setVisible(false);
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
    } as FieldErrors<IngredientCostField>,
    banner: request.banner,
    busy: request.busy,
    locked: request.unconfirmed,
    submit: () => void submit(),
  };
}

export type IngredientCostDialogState = ReturnType<typeof useIngredientCostDialog>;
