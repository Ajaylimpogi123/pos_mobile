/**
 * Recipes and product stock modes (Ingredients, Recipes & Purchasing §J).
 *
 * The cost preview mirrors the server with exact `BigInt` math (never
 * floats): `line_cost_cents = round_half_up(base_qty × unit_cost, 0)`, where
 * `unit_cost` is centavos per base unit (an ingredient's `avg_cost`, an own
 * product's `cost_cents`). The server's numbers replace the preview after a save.
 */
import type { DecimalValue, Product, StockMode } from './contract/types';
import { decimalParts, divRoundHalfUp } from './quantity';

/** §J: at most 50 lines per recipe. */
export const RECIPE_MAX_LINES = 50;

/** The stock mode selector's options, in order (§L wording). */
export const STOCK_MODES: readonly { value: StockMode; label: string; description: string }[] = [
  { value: 'own', label: 'Own stock', description: 'Sales deduct this item’s own stock.' },
  { value: 'recipe', label: 'Recipe', description: 'Sales deduct the ingredients of its recipe.' },
  { value: 'none', label: 'Not tracked', description: 'Sales don’t deduct any stock.' },
];

/**
 * A product's stock mode. Every `Product` carries `stock_mode` (Q-031); a
 * copy without it (cached before §J) reads as `own` or `none` from
 * `track_stock`, which §J keeps as `stock_mode == own`.
 */
export function stockModeOf(product: Pick<Product, 'track_stock' | 'stock_mode'>): StockMode {
  if (product.stock_mode === 'own' || product.stock_mode === 'recipe' || product.stock_mode === 'none') return product.stock_mode;
  return product.track_stock ? 'own' : 'none';
}

/** `round_half_up(base_qty × unit_cost, 0)` in integer centavos, or `null` when either isn't a decimal. */
export function recipeLineCostCents(baseQty: DecimalValue, unitCost: DecimalValue): number | null {
  const qty = decimalParts(baseQty);
  const cost = decimalParts(unitCost);
  if (!qty || !cost) return null;
  const cents = divRoundHalfUp(qty.digits * cost.digits, 10n ** BigInt(qty.scale + cost.scale));
  return Number(cents);
}

/** The cost of one serving: Σ line costs, or `null` while any line can't be priced. */
export function recipeCostCents(lineCosts: readonly (number | null)[]): number | null {
  let total = 0;
  for (const cost of lineCosts) {
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

/**
 * The server's `Margin::bps` (Q-031): `trunc((price − cost) × 10000 / price)`
 * toward zero (`BigInt` division truncates toward zero); `null` when the
 * price or the cost is 0 (the margin is unknown or meaningless).
 */
export function marginBps(priceCents: number, costCents: number): number | null {
  if (!Number.isSafeInteger(priceCents) || !Number.isSafeInteger(costCents) || priceCents <= 0 || costCents === 0) return null;
  return Number((BigInt(priceCents - costCents) * 10_000n) / BigInt(priceCents));
}
