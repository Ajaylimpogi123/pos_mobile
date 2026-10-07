import { useState } from 'react';

import type { FieldErrors } from '@/hooks/forms/formErrors';
import { useIngredientMutations } from '@/hooks/ingredients/useIngredients';
import { useCatalogForm } from '@/hooks/menu/useCatalogForm';
import { useUnits } from '@/hooks/units/useUnits';
import type {
  BaseUnit,
  Ingredient,
  IngredientCreateRequest,
  IngredientUnitRequest,
  IngredientUpdateRequest,
  Unit,
} from '@/services/types';
import { FACTOR_MAX_DECIMALS, parseFactorInput, toScaled } from '@/utils/quantity';
import { reservedUnitCode, reservedUnitMessage } from '@/utils/units';

/** Contract limits (§A, §D). */
export const INGREDIENT_LIMITS = { name: 120, unitName: 20, units: 50 } as const;

/** The 409 wording when the base unit can't change (§D). */
export const BASE_UNIT_LOCKED_MESSAGE = "The base unit can't change once the ingredient is in use.";

/** One row of the units editor: `1 <name> = <factor> <base unit>`. `key` is local (stable across edits). */
export type UnitRow = {
  key: string;
  /** An existing unit keeps its id (the set is replaced, ids keep what the server has). */
  id?: number;
  name: string;
  factor: string;
};

export type IngredientFormValues = {
  name: string;
  baseUnit: BaseUnit;
  isActive: boolean;
  units: UnitRow[];
};

type UnitRowField = `units.${number}.name` | `units.${number}.factor`;

/** Request fields with an input: the record's, and each unit row's (`units.0.name`, …). */
export type IngredientField = 'name' | 'base_unit' | 'is_active' | 'units' | UnitRowField;

const FIELD_OF: { [K in keyof IngredientFormValues]: IngredientField } = {
  name: 'name',
  baseUnit: 'base_unit',
  isActive: 'is_active',
  units: 'units',
};

let rowSequence = 0;

/** A new local row key. */
export function newUnitRowKey(): string {
  rowSequence += 1;
  return `unit-row-${rowSequence}`;
}

export function ingredientToValues(ingredient?: Ingredient): IngredientFormValues {
  return {
    name: ingredient?.name ?? '',
    baseUnit: ingredient?.base_unit ?? 'g',
    isActive: ingredient?.is_active ?? true,
    units: (ingredient?.units ?? []).map((unit) => ({
      key: newUnitRowKey(),
      id: unit.id,
      name: unit.name,
      factor: String(unit.factor),
    })),
  };
}

/** Every request field a 422 can name, for the current number of unit rows. */
export function ingredientFields(rowCount: number): IngredientField[] {
  const rows: IngredientField[] = [];
  for (let index = 0; index < rowCount; index += 1) rows.push(`units.${index}.name`, `units.${index}.factor`);
  return ['name', 'base_unit', 'is_active', 'units', ...rows];
}

const INGREDIENT_FIELDS = ingredientFields(INGREDIENT_LIMITS.units);

/**
 * Client-side checks mirroring §A / §D, then the body:
 * - name: required, max 120;
 * - each unit: a name (max 20, unique per ingredient ignoring case, not a
 *   standard code of the base unit's dimension) and a factor (> 0, at most
 *   1,000,000, at most 10 decimals).
 */
export function validateIngredient(
  values: IngredientFormValues,
  catalog: readonly Unit[],
): { body: IngredientCreateRequest | null; errors: FieldErrors<IngredientField> } {
  const errors: FieldErrors<IngredientField> = {};
  const name = values.name.trim();
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > INGREDIENT_LIMITS.name) errors.name = `Use ${INGREDIENT_LIMITS.name} characters or fewer.`;
  if (values.units.length > INGREDIENT_LIMITS.units) errors.units = `Use at most ${INGREDIENT_LIMITS.units} units.`;

  const seen = new Set<string>();
  const units: IngredientUnitRequest[] = [];
  values.units.forEach((row, index) => {
    const unitName = row.name.trim();
    const nameKey: UnitRowField = `units.${index}.name`;
    const factorKey: UnitRowField = `units.${index}.factor`;
    if (unitName === '') errors[nameKey] = 'Enter a unit name, e.g. sack.';
    else if (unitName.length > INGREDIENT_LIMITS.unitName) errors[nameKey] = `Use ${INGREDIENT_LIMITS.unitName} characters or fewer.`;
    else if (reservedUnitCode(unitName, values.baseUnit, catalog)) errors[nameKey] = reservedUnitMessage(unitName);
    else if (seen.has(unitName.toLowerCase())) errors[nameKey] = 'This ingredient already has a unit with this name.';
    seen.add(unitName.toLowerCase());

    const factor = parseFactorInput(row.factor);
    if (!factor.ok) {
      errors[factorKey] =
        factor.problem === 'decimals'
          ? `Use at most ${FACTOR_MAX_DECIMALS} decimals.`
          : factor.problem === 'max'
            ? 'Use at most 1,000,000.'
            : `Enter how many ${values.baseUnit} one unit holds, e.g. 25000.`;
    } else {
      units.push({ ...(row.id === undefined ? {} : { id: row.id }), name: unitName, factor: factor.value });
    }
  });

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { name, base_unit: values.baseUnit, is_active: values.isActive, units }, errors };
}

function sameUnits(saved: Ingredient['units'], next: readonly IngredientUnitRequest[]): boolean {
  if (saved.length !== next.length) return false;
  return saved.every((unit, index) => {
    const other = next[index];
    return (
      other !== undefined &&
      other.id === unit.id &&
      other.name === unit.name &&
      toScaled(other.factor, FACTOR_MAX_DECIMALS) === toScaled(unit.factor, FACTOR_MAX_DECIMALS)
    );
  });
}

/** Only what changed (PATCH is partial); `units` is sent as the whole set when any row changed. */
export function diffIngredient(saved: Ingredient, body: IngredientCreateRequest): IngredientUpdateRequest {
  const changes: IngredientUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if (body.base_unit !== saved.base_unit) changes.base_unit = body.base_unit;
  if (body.is_active !== undefined && body.is_active !== saved.is_active) changes.is_active = body.is_active;
  if (body.units && !sameUnits(saved.units, body.units)) changes.units = body.units;
  return changes;
}

type UseIngredientFormOptions = {
  initial?: Ingredient;
  onSaved: (ingredient: Ingredient) => void;
  onDeleted: () => void;
};

/**
 * Create / edit an ingredient (POST or PATCH /api/v1/admin/ingredients, then
 * the image upload), with the units editor. The base unit locks once the
 * ingredient is in use.
 */
export function useIngredientForm({ initial, onSaved, onDeleted }: UseIngredientFormOptions) {
  const { units: catalog } = useUnits();
  // Set by a 409 on a base-unit change: the base unit the server kept (the change is undone).
  const [conflictBaseUnit, setConflictBaseUnit] = useState<BaseUnit | null>(null);
  const [conflictLocked, setConflictLocked] = useState(false);
  const mutations = useIngredientMutations((savedBaseUnit) => {
    setConflictLocked(true);
    setConflictBaseUnit(savedBaseUnit ?? initial?.base_unit ?? null);
  });

  const withLock = (values: IngredientFormValues): IngredientFormValues =>
    conflictBaseUnit ? { ...values, baseUnit: conflictBaseUnit } : values;

  const form = useCatalogForm<IngredientFormValues, IngredientField, Ingredient, IngredientCreateRequest, IngredientUpdateRequest>({
    initial,
    toValues: ingredientToValues,
    validate: (values) => validateIngredient(withLock(values), catalog),
    diff: diffIngredient,
    // Every row the editor allows, so a 422 on `units.3.factor` lands under row 4.
    fields: INGREDIENT_FIELDS,
    fieldOf: FIELD_OF,
    mutations,
    imageName: (id) => `ingredient-${id}`,
    noun: 'ingredient',
    onSaved,
    onDeleted,
  });

  // Q-025: the server says when the ingredient is in use (`base_unit_locked`: any movement,
  // PR item or PO line). A 409 on a base-unit change still locks it, as a fallback.
  const baseUnitLocked = Boolean(form.saved && (form.saved.base_unit_locked || conflictLocked));
  /** The base unit to show and send: the kept one after a 409, else the picked one. */
  const baseUnit = conflictBaseUnit ?? form.values.baseUnit;

  function clearRowErrors() {
    form.setFieldErrors((current) => {
      const next: FieldErrors<IngredientField> = {};
      for (const [key, message] of Object.entries(current) as [IngredientField, string | undefined][]) {
        if (!key.startsWith('units.') && message) next[key] = message;
      }
      return next;
    });
  }

  function clearRowField(field: UnitRowField) {
    form.setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  const unitsEditor = {
    rows: form.values.units,
    add: () => {
      if (form.values.units.length >= INGREDIENT_LIMITS.units) return;
      form.setField('units', [...form.values.units, { key: newUnitRowKey(), name: '', factor: '' }]);
    },
    remove: (key: string) => {
      clearRowErrors();
      form.setField(
        'units',
        form.values.units.filter((row) => row.key !== key),
      );
    },
    setName: (index: number, name: string) => {
      clearRowField(`units.${index}.name`);
      form.setField(
        'units',
        form.values.units.map((row, at) => (at === index ? { ...row, name } : row)),
      );
    },
    setFactor: (index: number, factor: string) => {
      clearRowField(`units.${index}.factor`);
      form.setField(
        'units',
        form.values.units.map((row, at) => (at === index ? { ...row, factor } : row)),
      );
    },
    /** Inline check for a reserved code while typing (§L). */
    reservedMessage: (name: string): string | null =>
      name.trim() !== '' && reservedUnitCode(name, baseUnit, catalog) ? reservedUnitMessage(name) : null,
    errorOf: (index: number, part: 'name' | 'factor'): string | undefined => form.fieldErrors[`units.${index}.${part}`],
  };

  return {
    ...form,
    baseUnit,
    setBaseUnit: (value: BaseUnit) => {
      if (!baseUnitLocked) form.setField('baseUnit', value);
    },
    baseUnitLocked,
    unitsEditor,
  };
}

export type IngredientFormState = ReturnType<typeof useIngredientForm>;
