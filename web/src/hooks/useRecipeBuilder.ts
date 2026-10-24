/**
 * The recipe builder (Ingredients, Recipes & Purchasing §J / §L; Q-031, Q-032)
 * on the product edit page, ported from the tablet's
 * `mobile/src/hooks/menu/useRecipeBuilder.ts` (same rules and wording):
 * - `GET /admin/products/{id}/recipe` loads the lines per serving.
 * - Lines are added (the picker offers **active ingredients only**, per §L),
 *   edited (qty + a valid unit) and removed locally. While edited, each line
 *   and the total show a live `BigInt` preview from the components'
 *   `avg_cost` / `cost_cents` (`@pos/core/recipe`), and the margin from the
 *   price. Unedited, the server's `line_cost_cents`, `cost_cents` and `margin_bps` show.
 * - **Save recipe**: `PUT` with every line; 422s go under their line.
 * - **Use as product cost**: `POST …/recipe/apply-cost` (for the saved recipe).
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { catalogKeys, useCacheProduct } from '@/hooks/useCatalogAdmin';
import { useCursorList } from '@/hooks/useCursorList';
import { getAdminProduct } from '@/services/adminCatalog';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { applyRecipeCost, getAdminIngredient, getRecipe, listAdminIngredients, listUnits, updateRecipe } from '@/services/recipes';
import type { AdminProduct, BaseUnit, DecimalValue, Ingredient, Recipe, RecipeComponentType, RecipeLineRequest, Unit } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { isWholeQty, parseQtyInput, PRODUCT_WHOLE_MESSAGE, qtyProblemMessage, toBaseQty } from '@pos/core/quantity';
import { marginBps, RECIPE_MAX_LINES, recipeCostCents, recipeLineCostCents } from '@pos/core/recipe';
import { findUnit, ingredientUnitChoices, PRODUCT_UNIT_CHOICES, type UnitChoices } from '@pos/core/units';

export const RECIPE_DUPLICATE_MESSAGE = 'This component is already on the recipe.';

const unitsKey = ['units'] as const;
const ingredientKeys = {
  options: (search: string) => ['admin', 'ingredients', 'options', search] as const,
  detail: (id: number) => ['admin', 'ingredients', 'detail', id] as const,
};

/** The seeded unit catalog (`GET /units`), cached for the session. */
export function useUnits(enabled = true) {
  const query = useQuery({ queryKey: unitsKey, queryFn: listUnits, enabled, staleTime: Infinity });
  return { units: query.data ?? [], loading: query.isPending, error: query.isError ? getErrorMessage(query.error) : null };
}

/** The component picker's options: active ingredients only (§L), searched by name. */
export function useIngredientOptions(search: string, enabled: boolean) {
  return useCursorList(
    ingredientKeys.options(search),
    (cursor) => listAdminIngredients({ cursor, per_page: 25, search: search || undefined, is_active: true }),
    { enabled },
  );
}

/** The saved line a draft came from: its entered qty/unit, `base_qty` and cost as the server stored them. */
type SavedLine = { qty: string; unit: string; baseQty: DecimalValue; lineCostCents: number };

/** One line of the builder. `key` is local and stable. */
export type RecipeLineDraft = {
  key: string;
  type: RecipeComponentType;
  componentId: number;
  name: string;
  baseUnit: BaseUnit;
  /** A picked ingredient (its units); `null` for a product, or while a saved line's ingredient loads. */
  ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null;
  /** Centavos per base unit (`avg_cost` / `cost_cents`) for the live preview; `null`: unknown. */
  unitCost: DecimalValue | null;
  qty: string;
  unit: string;
  saved: SavedLine | null;
};

/** Field errors keyed as the API's 422: `lines`, `lines.<i>.component_id`, `lines.<i>.qty`, … */
export type RecipeFieldErrors = Record<string, string | undefined>;

let draftSequence = 0;
function newKey(): string {
  draftSequence += 1;
  return `recipe-line-${draftSequence}`;
}

function qtyText(value: DecimalValue): string {
  const parsed = parseQtyInput(String(value), { allowZero: true });
  return parsed.ok ? parsed.value : String(value);
}

function recipeToDrafts(recipe: Recipe | undefined): RecipeLineDraft[] {
  if (!recipe) return [];
  return recipe.lines.map((line) => {
    const qty = qtyText(line.qty);
    return {
      key: newKey(),
      type: line.component.type,
      componentId: line.component.id,
      name: line.component.name,
      baseUnit: line.component.base_unit,
      ingredient: null,
      unitCost: line.unit_cost,
      qty,
      unit: line.unit,
      saved: { qty, unit: line.unit, baseQty: line.base_qty, lineCostCents: line.line_cost_cents },
    };
  });
}

function lineUnitChoices(draft: RecipeLineDraft, catalog: readonly Unit[]): UnitChoices | null {
  if (draft.type === 'product') return PRODUCT_UNIT_CHOICES;
  return draft.ingredient ? ingredientUnitChoices(draft.ingredient, catalog) : null;
}

function isUnchanged(draft: RecipeLineDraft): boolean {
  return draft.saved !== null && draft.qty === draft.saved.qty && draft.unit === draft.saved.unit;
}

/** The line's `base_qty` for the preview: the server's while unchanged, else `round_half_up(qty × factor, 3)`. */
export function lineBaseQty(draft: RecipeLineDraft, choices: UnitChoices | null): string | null {
  if (isUnchanged(draft) && draft.saved) return String(draft.saved.baseQty);
  const unit = choices ? findUnit(choices, draft.unit) : null;
  const qty = parseQtyInput(draft.qty);
  if (!unit || !qty.ok) return null;
  return toBaseQty(qty.value, unit.factor);
}

function lineCostPreview(draft: RecipeLineDraft, choices: UnitChoices | null): number | null {
  const base = lineBaseQty(draft, choices);
  if (base === null || draft.unitCost === null) return null;
  return recipeLineCostCents(base, draft.unitCost);
}

/** Client checks mirroring §J (the server still validates). */
function validateRecipe(
  drafts: readonly RecipeLineDraft[],
  choicesOf: (draft: RecipeLineDraft) => UnitChoices | null,
): { lines: RecipeLineRequest[] | null; errors: RecipeFieldErrors } {
  const errors: RecipeFieldErrors = {};
  if (drafts.length > RECIPE_MAX_LINES) errors.lines = `Use at most ${RECIPE_MAX_LINES} components.`;
  const seen = new Set<string>();
  const lines: RecipeLineRequest[] = [];
  drafts.forEach((draft, index) => {
    const at = `lines.${index}`;
    const identity = `${draft.type}-${draft.componentId}`;
    if (seen.has(identity)) errors[`${at}.component_id`] = RECIPE_DUPLICATE_MESSAGE;
    seen.add(identity);
    const qty = parseQtyInput(draft.qty);
    if (!qty.ok) errors[`${at}.qty`] = qtyProblemMessage(qty.problem);
    else if (draft.type === 'product' && !isWholeQty(qty.value)) errors[`${at}.qty`] = PRODUCT_WHOLE_MESSAGE;
    const choices = choicesOf(draft);
    const unitOk = choices ? findUnit(choices, draft.unit) !== null : isUnchanged(draft);
    if (!unitOk) errors[`${at}.unit`] = 'Choose a unit.';
    if (!qty.ok || !unitOk) return;
    // Q-031: a product line's qty is an integer; an ingredient's a decimal string.
    if (draft.type === 'product') lines.push({ component_type: 'product', component_id: draft.componentId, qty: Number(qty.value), unit: 'pc' });
    else lines.push({ component_type: 'ingredient', component_id: draft.componentId, qty: qty.value, unit: draft.unit });
  });
  return Object.keys(errors).length > 0 ? { lines: null, errors } : { lines, errors };
}

function isLineField(field: string): boolean {
  return field === 'lines' || /^lines\.\d+\.(component_type|component_id|qty|unit)$/.test(field);
}

function firstErrors(errors: Record<string, string[]>): RecipeFieldErrors {
  const out: RecipeFieldErrors = {};
  for (const [field, messages] of Object.entries(errors)) if (messages[0] && isLineField(field)) out[field] = messages[0];
  for (const [field, message] of Object.entries(out)) {
    const match = /^lines\.(\d+)\.component_type$/.exec(field);
    if (match && !out[`lines.${match[1]}.component_id`]) out[`lines.${match[1]}.component_id`] = message;
  }
  return out;
}

/** A picked ingredient. */
export type RecipeComponentOption = Pick<Ingredient, 'id' | 'name' | 'base_unit' | 'units' | 'avg_cost'>;

type Options = {
  /** The saved product when its saved `stock_mode` is `recipe`; `null`: nothing loads. */
  product: AdminProduct | null;
  /** After "Use as product cost": the updated product. */
  onCostApplied: (product: AdminProduct) => void;
};

export function useRecipeBuilder({ product, onCostApplied }: Options) {
  const enabled = product !== null;
  const client = useQueryClient();
  const cacheProduct = useCacheProduct();
  const { units: catalog } = useUnits(enabled);
  const productId = product?.id ?? -1;
  const [edited, setEdited] = useState<RecipeLineDraft[] | null>(null);
  const [localErrors, setLocalErrors] = useState<RecipeFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<RecipeFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({ queryKey: catalogKeys.recipe(productId), queryFn: () => getRecipe(productId), enabled });
  const recipe = query.data;
  const baseDrafts = useMemo(() => recipeToDrafts(recipe), [recipe]);
  const drafts = edited ?? baseDrafts;
  const dirty = edited !== null;

  // Saved ingredient lines need their units (GET /admin/ingredients/{id}).
  const ingredientIds = useMemo(
    () => [...new Set(drafts.filter((draft) => draft.type === 'ingredient' && draft.ingredient === null).map((draft) => draft.componentId))],
    [drafts],
  );
  const loaded = useQueries({
    queries: ingredientIds.map((id) => ({ queryKey: ingredientKeys.detail(id), queryFn: () => getAdminIngredient(id), enabled })),
  });
  const loadedById = new Map<number, { ingredient: Ingredient | null; failed: boolean }>();
  loaded.forEach((result, index) => {
    const id = ingredientIds[index];
    if (id !== undefined) loadedById.set(id, { ingredient: result.data ?? null, failed: result.isError });
  });

  function withIngredient(draft: RecipeLineDraft): RecipeLineDraft {
    if (draft.type !== 'ingredient' || draft.ingredient) return draft;
    const ingredient = loadedById.get(draft.componentId)?.ingredient ?? null;
    return ingredient ? { ...draft, ingredient } : draft;
  }

  function choicesOf(draft: RecipeLineDraft): UnitChoices | null {
    return lineUnitChoices(withIngredient(draft), catalog);
  }

  function unitsFailed(draft: RecipeLineDraft): boolean {
    return draft.type === 'ingredient' && !draft.ingredient && Boolean(loadedById.get(draft.componentId)?.failed);
  }

  const save = useMutation({ mutationFn: (lines: RecipeLineRequest[]) => updateRecipe(productId, { lines }) });
  const apply = useMutation({ mutationFn: async () => (await applyRecipeCost(productId)) ?? getAdminProduct(productId) });
  const busy = save.isPending || apply.isPending;
  const errors: RecipeFieldErrors = { ...serverErrors, ...localErrors };

  function edit(change: (current: RecipeLineDraft[]) => RecipeLineDraft[], clear: string[] | 'all') {
    if (busy) return;
    setEdited((current) => change((current ?? baseDrafts).map(withIngredient)));
    setNotice(null);
    const strip = (current: RecipeFieldErrors) => {
      if (clear === 'all') return {};
      if (!clear.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of clear) delete next[key];
      return next;
    };
    setLocalErrors(strip);
    setServerErrors(strip);
  }

  function addIngredient(option: RecipeComponentOption) {
    if (drafts.length >= RECIPE_MAX_LINES) return;
    if (drafts.some((draft) => draft.type === 'ingredient' && draft.componentId === option.id)) {
      setBanner(`${option.name}: ${RECIPE_DUPLICATE_MESSAGE}`);
      return;
    }
    setBanner(null);
    edit(
      (current) => [
        ...current,
        {
          key: newKey(),
          type: 'ingredient',
          componentId: option.id,
          name: option.name,
          baseUnit: option.base_unit,
          ingredient: { base_unit: option.base_unit, units: option.units },
          unitCost: option.avg_cost,
          qty: '',
          // A new component starts in its base unit.
          unit: option.base_unit,
          saved: null,
        },
      ],
      ['lines'],
    );
  }

  async function submit() {
    if (busy || !dirty) return;
    setBanner(null);
    setNotice(null);
    const checked = validateRecipe(drafts.map(withIngredient), choicesOf);
    setLocalErrors(checked.errors);
    setServerErrors({});
    if (!checked.lines) return;
    try {
      const saved = await save.mutateAsync(checked.lines);
      client.setQueryData(catalogKeys.recipe(productId), saved);
      setEdited(null);
      setNotice('Recipe saved.');
    } catch (error) {
      if (isApiValidationError(error)) {
        const shown = firstErrors(error.errors);
        setServerErrors(shown);
        if (Object.keys(shown).length === 0) setBanner(error.message);
      } else {
        setBanner(getErrorMessage(error));
      }
    }
  }

  async function applyCost() {
    if (busy || dirty || !recipe) return;
    setBanner(null);
    setNotice(null);
    try {
      const updated = await apply.mutateAsync();
      cacheProduct(updated);
      onCostApplied(updated);
      setNotice(`Product cost set to ${formatPeso(updated.cost_cents)}.`);
    } catch (error) {
      setBanner(getErrorMessage(error));
    }
  }

  const lineCosts = drafts.map((draft) => {
    if (!dirty && draft.saved) return draft.saved.lineCostCents;
    return lineCostPreview(withIngredient(draft), choicesOf(draft));
  });
  const priceCents = recipe?.price_cents ?? product?.price_cents ?? 0;
  const costCents = dirty ? recipeCostCents(lineCosts) : (recipe?.cost_cents ?? null);
  let margin: number | null = null;
  if (!dirty && recipe) margin = recipe.margin_bps;
  else if (costCents !== null) margin = marginBps(priceCents, costCents);

  return {
    loading: enabled && query.isPending,
    loadError: recipe ? null : query.isError ? getErrorMessage(query.error) : null,
    retry: () => void query.refetch(),
    recipe,
    drafts,
    dirty,
    errors,
    banner,
    notice,
    busy,
    saving: save.isPending,
    applying: apply.isPending,
    full: drafts.length >= RECIPE_MAX_LINES,
    choicesOf,
    unitsFailed,
    lineCosts,
    costCents,
    priceCents,
    marginBps: margin,
    isPreview: dirty,
    addIngredient,
    setQty: (index: number, qty: string) =>
      edit((current) => current.map((draft, at) => (at === index ? { ...draft, qty } : draft)), [`lines.${index}.qty`]),
    setUnit: (index: number, unit: string) =>
      edit((current) => current.map((draft, at) => (at === index ? { ...draft, unit } : draft)), [`lines.${index}.unit`]),
    // Row indices shift: every line error is dropped rather than shown under the wrong line.
    removeLine: (key: string) => edit((current) => current.filter((draft) => draft.key !== key), 'all'),
    discard: () => {
      if (busy) return;
      setEdited(null);
      setLocalErrors({});
      setServerErrors({});
      setBanner(null);
      setNotice(null);
    },
    submit: () => void submit(),
    applyCost: () => void applyCost(),
    dismissBanner: () => setBanner(null),
  };
}

export type RecipeBuilderState = ReturnType<typeof useRecipeBuilder>;
