import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { menuKeys } from '@/hooks/menu/queryKeys';
import { cacheSavedProduct } from '@/hooks/menu/useAdminProducts';
import type { RecipeComponentOption } from '@/hooks/menu/useRecipeComponentPicker';
import { ingredientKeys } from '@/hooks/purchasing/queryKeys';
import { useUnits } from '@/hooks/units/useUnits';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getAdminProduct } from '@/services/adminCatalog';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { getIngredient } from '@/services/ingredients';
import { applyRecipeCost, getRecipe, updateRecipe } from '@/services/recipes';
import type {
  AdminProduct,
  BaseUnit,
  DecimalValue,
  Ingredient,
  Recipe,
  RecipeComponentType,
  RecipeLineRequest,
  Unit,
} from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { isWholeQty, parseQtyInput, PRODUCT_WHOLE_MESSAGE, qtyProblemMessage, toBaseQty } from '@pos/core/quantity';
import { marginBps, RECIPE_MAX_LINES, recipeCostCents, recipeLineCostCents } from '@pos/core/recipe';
import { findUnit, ingredientUnitChoices, PRODUCT_UNIT_CHOICES, type UnitChoices } from '@pos/core/units';

/** Contract wording while the device has no connection (the recipe builder needs one). */
export const RECIPE_OFFLINE_MESSAGE = 'Recipes need a connection.';

export const RECIPE_DUPLICATE_MESSAGE = 'This component is already on the recipe.';

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

export function recipeToDrafts(recipe: Recipe | undefined): RecipeLineDraft[] {
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

/** The line's valid units (§A): `pc` for a product, the ingredient's units; `null` while they load. */
export function lineUnitChoices(draft: RecipeLineDraft, catalog: readonly Unit[]): UnitChoices | null {
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

/** The live line cost (integer centavos), or `null` when the qty, unit or unit cost can't be read yet. */
export function lineCostPreview(draft: RecipeLineDraft, choices: UnitChoices | null): number | null {
  const base = lineBaseQty(draft, choices);
  if (base === null || draft.unitCost === null) return null;
  return recipeLineCostCents(base, draft.unitCost);
}

/**
 * Client-side checks mirroring §J (the server still validates): at most 50
 * lines, no duplicate component, a quantity > 0 (≤ 3 decimals, ≤ 1,000,000)
 * in a unit valid for the component; a product's quantity is whole.
 */
export function validateRecipe(
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
    // A product component counts whole pieces (Q-031, as purchase requests: Q-030).
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

/** The 422 keys shown under a line (or above them): everything else goes to the banner. */
function isLineField(field: string): boolean {
  return field === 'lines' || /^lines\.\d+\.(component_type|component_id|qty|unit)$/.test(field);
}

function firstErrors(errors: Record<string, string[]>): RecipeFieldErrors {
  const out: RecipeFieldErrors = {};
  for (const [field, messages] of Object.entries(errors)) if (messages[0] && isLineField(field)) out[field] = messages[0];
  // The component's type error shows where the component is picked.
  for (const [field, message] of Object.entries(out)) {
    const match = /^lines\.(\d+)\.component_type$/.exec(field);
    if (match && !out[`lines.${match[1]}.component_id`]) out[`lines.${match[1]}.component_id`] = message;
  }
  return out;
}

/** Where the component picker writes: a line (by index), or a new line. */
export type PickerTarget = number | 'new' | null;

type UseRecipeBuilderOptions = {
  /** The saved product when its `stock_mode` is `recipe`; `null`: no recipe (nothing loads). */
  product: AdminProduct | null;
  /** After "Use as product cost": the updated product (so the form shows the new cost). */
  onCostApplied: (product: AdminProduct) => void;
};

/**
 * The recipe builder (§J / §L) on the product edit screen:
 * - `GET /admin/products/{id}/recipe` loads the lines per serving.
 * - Lines are added (component picker: ingredients + own-stock products),
 *   edited (qty + a valid unit) and removed locally; while edited, each line
 *   and the total show a live `BigInt` cost preview from the components'
 *   `avg_cost` / `cost_cents`, and the margin from the product's price.
 *   Unedited, the server's `line_cost_cents`, `cost_cents` and `margin_bps` show.
 * - **Save recipe**: `PUT` with every line; 422s go under their line.
 * - **Use as product cost**: `POST …/recipe/apply-cost` (for the saved recipe).
 * State lives here, above every layout switch, so rotation keeps the edits.
 */
export function useRecipeBuilder({ product, onCostApplied }: UseRecipeBuilderOptions) {
  const enabled = product !== null;
  const client = useQueryClient();
  const online = useIsOnline();
  const { units: catalog } = useUnits(enabled);
  const productId = product?.id ?? -1;
  const [edited, setEdited] = useState<RecipeLineDraft[] | null>(null);
  const [localErrors, setLocalErrors] = useState<RecipeFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  const query = useQuery({
    queryKey: menuKeys.recipe(productId),
    queryFn: () => getRecipe(productId),
    enabled: enabled && online,
  });
  const recipe = query.data;
  const baseDrafts = useMemo(() => recipeToDrafts(recipe), [recipe]);
  const drafts = edited ?? baseDrafts;
  const dirty = edited !== null;

  // Saved ingredient lines need their units (GET /admin/ingredients/{id}), as a purchase request's items do.
  const ingredientIds = useMemo(
    () => [...new Set(drafts.filter((draft) => draft.type === 'ingredient' && draft.ingredient === null).map((draft) => draft.componentId))],
    [drafts],
  );
  const loaded = useQueries({
    queries: ingredientIds.map((id) => ({
      queryKey: ingredientKeys.detail(id),
      queryFn: () => getIngredient(id),
      enabled: enabled && online,
    })),
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

  /** A saved ingredient line whose units couldn't load (e.g. the ingredient was deleted). */
  function unitsFailed(draft: RecipeLineDraft): boolean {
    return draft.type === 'ingredient' && !draft.ingredient && Boolean(loadedById.get(draft.componentId)?.failed);
  }

  const save = useMutation({
    mutationFn: (lines: RecipeLineRequest[]) => updateRecipe(productId, { lines }),
  });
  const apply = useMutation({
    mutationFn: async () => (await applyRecipeCost(productId)) ?? getAdminProduct(productId),
  });
  const busy = save.isPending || apply.isPending;
  const disabled = busy || !online;
  const [serverErrors, setServerErrors] = useState<RecipeFieldErrors>({});
  const errors: RecipeFieldErrors = { ...serverErrors, ...localErrors };

  function clearMessages() {
    setBanner(null);
    setNotice(null);
  }

  function edit(change: (current: RecipeLineDraft[]) => RecipeLineDraft[], clear: string[] | 'all') {
    if (disabled) return;
    // Loaded ingredients are kept on the edited copy, so its units stay after the edit.
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

  function pick(option: RecipeComponentOption) {
    const target = pickerTarget;
    setPickerTarget(null);
    const fromOption = {
      type: option.type,
      componentId: option.id,
      name: option.name,
      baseUnit: option.ingredient ? option.ingredient.base_unit : ('pc' as const),
      ingredient: option.ingredient,
      unitCost: option.unitCost,
      // A new component starts in its base unit (a product: pc).
      unit: option.ingredient ? option.ingredient.base_unit : 'pc',
      saved: null,
    };
    if (target === 'new') {
      if (drafts.length >= RECIPE_MAX_LINES) return;
      edit((current) => [...current, { key: newKey(), qty: '', ...fromOption }], ['lines']);
    } else if (typeof target === 'number') {
      edit(
        (current) => current.map((draft, at) => (at === target ? { ...draft, ...fromOption } : draft)),
        [`lines.${target}.component_id`, `lines.${target}.component_type`, `lines.${target}.unit`],
      );
    }
  }

  async function submit() {
    if (busy || !online || !dirty) return;
    clearMessages();
    const checked = validateRecipe(drafts.map(withIngredient), choicesOf);
    setLocalErrors(checked.errors);
    setServerErrors({});
    if (!checked.lines) return;
    try {
      const saved = await save.mutateAsync(checked.lines);
      client.setQueryData(menuKeys.recipe(productId), saved);
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
    if (busy || !online || dirty || !recipe) return;
    clearMessages();
    try {
      const updated = await apply.mutateAsync();
      cacheSavedProduct(client, updated);
      void client.invalidateQueries({ queryKey: menuKeys.productLists() });
      onCostApplied(updated);
      setNotice(`Product cost set to ${formatPeso(updated.cost_cents)}.`);
    } catch (error) {
      setBanner(getErrorMessage(error));
    }
  }

  // Costs: the server's while unedited; the live preview while edited.
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
    online,
    /** First load (no recipe yet). */
    loading: enabled && online && query.isPending,
    loadError: recipe ? null : query.error,
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
    /** Edits, Save and Apply are off while a request runs or offline. */
    disabled,
    choicesOf,
    unitsFailed,
    lineCosts,
    costCents,
    priceCents,
    marginBps: margin,
    /** The totals are a live preview (edited, not saved yet). */
    isPreview: dirty,
    pickerTarget,
    openPicker: (target: Exclude<PickerTarget, null>) => {
      if (disabled) return;
      if (target === 'new' && drafts.length >= RECIPE_MAX_LINES) return;
      setPickerTarget(target);
    },
    closePicker: () => setPickerTarget(null),
    pick,
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
      clearMessages();
    },
    submit: () => void submit(),
    applyCost: () => void applyCost(),
    dismissBanner: () => setBanner(null),
  };
}

export type RecipeBuilderState = ReturnType<typeof useRecipeBuilder>;
