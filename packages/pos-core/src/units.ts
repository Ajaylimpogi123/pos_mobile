/**
 * Valid units for an item (Ingredients, Recipes & Purchasing §A and §L):
 * - an ingredient: its own units first (*This ingredient's units*), then the
 *   catalog units of its base unit's dimension. An own unit that reuses a
 *   catalog code takes precedence for that ingredient.
 * - an `own`-stock product: `pc` only (factor 1).
 * Factors stay exact decimal strings; conversions go through `@/utils/quantity`.
 */
import type { BaseUnit, DecimalValue, Ingredient, PurchaseItemType, Unit, UnitDimension } from '@/services/types';

/** The dimension of each base unit. */
export const BASE_UNIT_DIMENSION: Readonly<Record<BaseUnit, UnitDimension>> = {
  g: 'mass',
  mL: 'volume',
  pc: 'count',
};

/** The base unit picker's options, in order. */
export const BASE_UNITS: readonly { value: BaseUnit; label: string; hint: string }[] = [
  { value: 'g', label: 'Grams (g)', hint: 'Weighed: flour, meat, sugar' },
  { value: 'mL', label: 'Milliliters (mL)', hint: 'Poured: milk, oil, syrup' },
  { value: 'pc', label: 'Pieces (pc)', hint: 'Counted: eggs, buns, cups' },
];

export type UnitGroup = 'own' | 'catalog';

/** One choice of the unit picker. */
export type UnitOption = {
  code: string;
  /** e.g. `Kilogram`, or `1 sack = 25,000 g` for an own unit. */
  name: string;
  /** Exact: 1 `code` = `factor` base units. */
  factor: string;
  group: UnitGroup;
};

/** The picker's options for one item, in its two groups. */
export type UnitChoices = {
  baseUnit: string;
  own: UnitOption[];
  catalog: UnitOption[];
};

/** An `own`-stock product counts in pieces only (§A). */
export const PRODUCT_UNIT_CHOICES: UnitChoices = {
  baseUnit: 'pc',
  own: [],
  catalog: [{ code: 'pc', name: 'Piece', factor: '1', group: 'catalog' }],
};

function sameCode(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The valid units of an ingredient: its own units, then the catalog units of its dimension (own codes win). */
export function ingredientUnitChoices(
  ingredient: Pick<Ingredient, 'base_unit' | 'units'>,
  catalog: readonly Unit[],
): UnitChoices {
  const dimension = BASE_UNIT_DIMENSION[ingredient.base_unit];
  const own: UnitOption[] = ingredient.units.map((unit) => ({
    code: unit.name,
    name: unit.name,
    factor: String(unit.factor),
    group: 'own',
  }));
  const catalogOptions: UnitOption[] = catalog
    .filter((unit) => unit.dimension === dimension)
    .filter((unit) => !own.some((option) => option.code === unit.code))
    .map((unit) => ({ code: unit.code, name: unit.name, factor: String(unit.factor_to_base), group: 'catalog' }));
  // The base unit is always valid, even before the catalog has loaded.
  if (!catalogOptions.some((option) => option.code === ingredient.base_unit) && !own.some((o) => o.code === ingredient.base_unit)) {
    catalogOptions.unshift({ code: ingredient.base_unit, name: ingredient.base_unit, factor: '1', group: 'catalog' });
  }
  return { baseUnit: ingredient.base_unit, own, catalog: catalogOptions };
}

/** The valid units of a purchase item: an ingredient's (as above), or `pc` for a product. */
export function itemUnitChoices(
  type: PurchaseItemType,
  ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null,
  catalog: readonly Unit[],
): UnitChoices {
  if (type === 'product' || !ingredient) return PRODUCT_UNIT_CHOICES;
  return ingredientUnitChoices(ingredient, catalog);
}

/** Every option of a choice set, own units first. */
export function allUnitOptions(choices: UnitChoices): UnitOption[] {
  return [...choices.own, ...choices.catalog];
}

/** The option for `code`, or `null` when it isn't valid for the item. */
export function findUnit(choices: UnitChoices, code: string): UnitOption | null {
  return allUnitOptions(choices).find((option) => option.code === code) ?? null;
}

/** The factor of `code` for the item, or `null` when the unit isn't valid for it. */
export function unitFactor(choices: UnitChoices, code: string): DecimalValue | null {
  return findUnit(choices, code)?.factor ?? null;
}

/**
 * §A: an ingredient unit may not reuse a catalog code of the ingredient's own
 * dimension (e.g. `kg` on a `g` ingredient). Checked case-insensitively
 * (Q-025). Codes of other dimensions are fine (`cup = 120` g of flour).
 */
export function reservedUnitCode(name: string, baseUnit: BaseUnit, catalog: readonly Unit[]): string | null {
  const dimension = BASE_UNIT_DIMENSION[baseUnit];
  if (sameCode(name, baseUnit)) return baseUnit;
  const match = catalog.find((unit) => unit.dimension === dimension && sameCode(unit.code, name));
  return match ? match.code : null;
}

/** `"kg" is already a standard unit.` (§A wording, with the typed name). */
export function reservedUnitMessage(name: string): string {
  return `"${name.trim()}" is already a standard unit.`;
}
