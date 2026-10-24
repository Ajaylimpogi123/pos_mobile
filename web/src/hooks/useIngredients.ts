/**
 * Ingredients admin (Ingredients, Recipes & Purchasing §A, §D; Q-025, Q-030),
 * ported from the tablet's `mobile/src/hooks/ingredients/useIngredients.ts`
 * and `useIngredientForm.ts` (same rules and wording):
 * - the list (`GET /admin/ingredients`: `search`, `is_active`), the read, the
 *   save (POST / PATCH with the changed fields only, `units` as the whole set,
 *   then the image step), and the delete (409s in the dialog);
 * - the units editor's checks: a name (max 20, unique ignoring case, not a
 *   standard code of the base unit's dimension) and a factor (> 0, ≤ 1,000,000,
 *   ≤ 10 decimals), with exact `BigInt` decimals from `@pos/core/quantity`.
 * The base unit locks when the server says `base_unit_locked` (or after its 409).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ImageStepError, type ImageChange } from '@/hooks/useCatalogAdmin';
import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import {
  createIngredient,
  deleteIngredient,
  deleteIngredientImage,
  getAdminIngredient,
  listAdminIngredients,
  updateIngredient,
  uploadIngredientImage,
} from '@/services/ingredients';
import type { BaseUnit, Ingredient, IngredientCreateRequest, IngredientUnitRequest, IngredientUpdateRequest, Unit } from '@/services/types';
import type { FieldErrors } from '@/utils/forms';
import { FACTOR_MAX_DECIMALS, parseFactorInput, toScaled } from '@pos/core/quantity';
import { reservedUnitCode, reservedUnitMessage } from '@pos/core/units';

/** Contract limits (§A, §D). */
export const INGREDIENT_LIMITS = { name: 120, unitName: 20, units: 50 } as const;

/** The 409 wording when the base unit can't change (§D). */
export const BASE_UNIT_LOCKED_MESSAGE = "The base unit can't change once the ingredient is in use.";

/** Shares its root with the recipe builder's ingredient queries (`useRecipeBuilder`). */
export const ingredientKeys = {
  all: ['admin', 'ingredients'] as const,
  lists: ['admin', 'ingredients', 'list'] as const,
  list: (search: string, isActive: boolean | null) => ['admin', 'ingredients', 'list', search, isActive] as const,
  detail: (id: number) => ['admin', 'ingredients', 'detail', id] as const,
};

/** The ingredient stock screens' root (`useIngredientStock`). */
export const ingredientStockRoot = ['inventory', 'ingredients'] as const;

/** Recipes cost their lines from `avg_cost`; they refresh after an ingredient change. */
const recipeRoot = ['admin', 'catalog', 'products', 'recipe'] as const;

export function refreshIngredients(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ingredientKeys.all });
  void client.invalidateQueries({ queryKey: ingredientStockRoot });
  void client.invalidateQueries({ queryKey: recipeRoot });
}

export function useIngredientList(search: string, isActive: boolean | null) {
  return useCursorList(ingredientKeys.list(search, isActive), (cursor) =>
    listAdminIngredients({ cursor, per_page: 25, search: search || undefined, is_active: isActive ?? undefined }),
  );
}

export function useIngredient(id: number | null) {
  const query = useQuery({ queryKey: ingredientKeys.detail(id ?? 0), queryFn: () => getAdminIngredient(id as number), enabled: id !== null });
  return {
    ingredient: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

type IngredientSave = { body: IngredientCreateRequest | IngredientUpdateRequest; image: ImageChange };

export function useSaveIngredient(id: number | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, image }: IngredientSave): Promise<Ingredient> => {
      let saved =
        id === null
          ? await createIngredient(body as IngredientCreateRequest)
          : Object.keys(body).length > 0
            ? await updateIngredient(id, body)
            : await getAdminIngredient(id);
      try {
        if (image.kind === 'upload') saved = await uploadIngredientImage(saved.id, image.image.blob, image.image.name);
        if (image.kind === 'remove' && saved.image_path !== null) saved = await deleteIngredientImage(saved.id);
      } catch (error) {
        client.setQueryData(ingredientKeys.detail(saved.id), saved);
        refreshIngredients(client);
        throw new ImageStepError(`Saved, but the image wasn't changed: ${getErrorMessage(error)}`, saved.id);
      }
      return saved;
    },
    onSuccess: (saved) => {
      client.setQueryData(ingredientKeys.detail(saved.id), saved);
      refreshIngredients(client);
    },
  });
}

export function useDeleteIngredient() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteIngredient(id), onSuccess: () => refreshIngredients(client) });
}

// ---------------------------------------------------------------------------
// Form checks
// ---------------------------------------------------------------------------

/** One row of the units editor: `1 <name> = <factor> <base unit>`. `key` is local. */
export type UnitRow = { key: string; id?: number; name: string; factor: string };

export type IngredientDraft = { name: string; baseUnit: BaseUnit; isActive: boolean; units: UnitRow[] };

let rowSequence = 0;
export function newUnitRowKey(): string {
  rowSequence += 1;
  return `unit-row-${rowSequence}`;
}

export function ingredientDraft(ingredient: Ingredient | null): IngredientDraft {
  return {
    name: ingredient?.name ?? '',
    baseUnit: ingredient?.base_unit ?? 'g',
    isActive: ingredient?.is_active ?? true,
    units: (ingredient?.units ?? []).map((unit) => ({ key: newUnitRowKey(), id: unit.id, name: unit.name, factor: String(unit.factor) })),
  };
}

/** Every request field a 422 can name for `rows` unit rows (`units.3.factor` lands under row 4). */
export function ingredientFields(rows: number): string[] {
  const fields = ['name', 'base_unit', 'is_active', 'units', 'image'];
  for (let index = 0; index < rows; index += 1) fields.push(`units.${index}.name`, `units.${index}.factor`, `units.${index}`);
  return fields;
}

/** Inline check while typing: a standard code of the base unit's dimension (§A, case-insensitive). */
export function reservedNameMessage(name: string, baseUnit: BaseUnit, catalog: readonly Unit[]): string | null {
  return name.trim() !== '' && reservedUnitCode(name, baseUnit, catalog) ? reservedUnitMessage(name) : null;
}

/** Client-side checks mirroring §A / §D, then the create body. */
export function validateIngredient(draft: IngredientDraft, catalog: readonly Unit[]): { body: IngredientCreateRequest | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > INGREDIENT_LIMITS.name) errors.name = `Use ${INGREDIENT_LIMITS.name} characters or fewer.`;
  if (draft.units.length > INGREDIENT_LIMITS.units) errors.units = `Use at most ${INGREDIENT_LIMITS.units} units.`;

  const seen = new Set<string>();
  const units: IngredientUnitRequest[] = [];
  draft.units.forEach((row, index) => {
    const unitName = row.name.trim();
    const nameKey = `units.${index}.name`;
    const factorKey = `units.${index}.factor`;
    if (unitName === '') errors[nameKey] = 'Enter a unit name, e.g. sack.';
    else if (unitName.length > INGREDIENT_LIMITS.unitName) errors[nameKey] = `Use ${INGREDIENT_LIMITS.unitName} characters or fewer.`;
    else if (reservedUnitCode(unitName, draft.baseUnit, catalog)) errors[nameKey] = reservedUnitMessage(unitName);
    else if (seen.has(unitName.toLowerCase())) errors[nameKey] = 'This ingredient already has a unit with this name.';
    seen.add(unitName.toLowerCase());

    const factor = parseFactorInput(row.factor);
    if (!factor.ok) {
      errors[factorKey] =
        factor.problem === 'decimals'
          ? `Use at most ${FACTOR_MAX_DECIMALS} decimals.`
          : factor.problem === 'max'
            ? 'Use at most 1,000,000.'
            : `Enter how many ${draft.baseUnit} one unit holds, e.g. 25000.`;
    } else {
      units.push({ ...(row.id === undefined ? {} : { id: row.id }), name: unitName, factor: factor.value });
    }
  });

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { name, base_unit: draft.baseUnit, is_active: draft.isActive, units }, errors };
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

/** Only what changed (PATCH is partial); `units` goes as the whole set when any row changed. */
export function diffIngredient(saved: Ingredient, body: IngredientCreateRequest): IngredientUpdateRequest {
  const changes: IngredientUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if (body.base_unit !== saved.base_unit) changes.base_unit = body.base_unit;
  if (body.is_active !== undefined && body.is_active !== saved.is_active) changes.is_active = body.is_active;
  if (body.units && !sameUnits(saved.units, body.units)) changes.units = body.units;
  return changes;
}
