/**
 * Inventory (v1 completion) wording, shared by the list, the detail, the
 * report and the Sell tiles, so each status and movement reads the same everywhere.
 */
import type { ChipVariant } from '@/components/ui/Chip';
import type { IconName } from '@/components/ui/Icon';
import type { Ingredient, IngredientMovementType, StockMovementType, StockStatus } from '@/services/types';
import { formatPeso } from '@/utils/money';
import { formatCount, NO_VALUE } from '@/utils/numbers';
import { costDisplayUnit, costForBaseUnits } from '@/utils/quantity';

/** `₱46.67 / kg` from `avg_cost` (centavos per base unit), rounded half up; `—` when it can't be read. */
export function averageCostText(ingredient: Pick<Ingredient, 'avg_cost' | 'base_unit'>): string {
  const per = costDisplayUnit(ingredient.base_unit);
  const cents = costForBaseUnits(ingredient.avg_cost, per.baseUnits);
  return cents === null ? NO_VALUE : `${formatPeso(cents)} / ${per.unit}`;
}

/** Contract wording while the device has no connection (the Inventory screens need one). */
export const INVENTORY_OFFLINE_MESSAGE = 'Inventory needs a connection.';

/** The status chip: `In stock` completed, `Low` caution, `Out` cancelled. */
export const STOCK_STATUS_CHIP: Record<StockStatus, { label: string; variant: ChipVariant }> = {
  in_stock: { label: 'In stock', variant: 'completed' },
  low: { label: 'Low', variant: 'caution' },
  out: { label: 'Out', variant: 'cancelled' },
};

/** `Reorder at 10`, or `No reorder level`. */
export function reorderText(level: number | null): string {
  return level === null ? 'No reorder level' : `Reorder at ${formatCount(level)}`;
}

/** Each movement type's label and icon, in the order of the history's type filter. */
export const MOVEMENT_TYPES: readonly { value: StockMovementType; label: string; icon: IconName }[] = [
  { value: 'receipt', label: 'Stock in', icon: 'arrow-down-circle-outline' },
  { value: 'sale', label: 'Sale', icon: 'cart-outline' },
  { value: 'void', label: 'Void', icon: 'close-circle-outline' },
  { value: 'refund', label: 'Refund', icon: 'return-down-back-outline' },
  { value: 'wastage', label: 'Wastage', icon: 'trash-outline' },
  { value: 'count', label: 'Count', icon: 'clipboard-outline' },
  { value: 'adjustment', label: 'Adjustment', icon: 'swap-vertical-outline' },
  { value: 'opening', label: 'Opening', icon: 'flag-outline' },
];

/** §D1: the ingredient-only `revaluation` (a manual cost); ingredient histories filter by it too. */
const REVALUATION_TYPE = { value: 'revaluation' as const, label: 'Cost set', icon: 'pricetag-outline' as IconName };

/** An ingredient history's type filter: the product types plus `revaluation`. */
export const INGREDIENT_MOVEMENT_TYPES: readonly { value: IngredientMovementType; label: string; icon: IconName }[] = [
  ...MOVEMENT_TYPES,
  REVALUATION_TYPE,
];

const BY_TYPE = new Map<string, { label: string; icon: IconName }>(INGREDIENT_MOVEMENT_TYPES.map((entry) => [entry.value, entry]));

/** The label and icon of a movement type (an unknown type from a newer server reads as an adjustment). */
export function movementTypeInfo(type: string): { label: string; icon: IconName } {
  return BY_TYPE.get(type) ?? { label: 'Adjustment', icon: 'swap-vertical-outline' };
}

/**
 * §J: how an ingredient's recipe movements read in its history: a sale
 * **used** it, a void **returned** it, and a refund's share was **wasted**
 * (Q-031: a `wastage` entry whose reference is the refund; the food was
 * already made). Every other type reads as in `MOVEMENT_TYPES`.
 */
export function ingredientMovementLabel(type: string, referenceKind: string | null): string {
  if (type === 'sale') return 'Used · sale';
  if (type === 'void') return 'Returned · void';
  if (isRefundWaste(type, referenceKind)) return 'Wasted · refund';
  return movementTypeInfo(type).label;
}

/** Q-031: a refund's recipe waste (`wastage`, `qty_delta` 0, the wasted amount in `entered_qty` + `entered_unit`). */
export function isRefundWaste(type: string, referenceKind: string | null): boolean {
  return type === 'wastage' && referenceKind === 'refund';
}

/**
 * §D1: a `revaluation` reads `Cost set · ₱1,250.00 / sack` (`unit_cost_cents`
 * per `entered_unit`), or `Cost set` when either is missing.
 */
export function revaluationLabel(unitCostCents: number | null, enteredUnit: string | null): string {
  if (unitCostCents === null || !Number.isSafeInteger(unitCostCents) || !enteredUnit) return REVALUATION_TYPE.label;
  return `${REVALUATION_TYPE.label} · ${formatPeso(unitCostCents)} / ${enteredUnit}`;
}

/** A signed quantity: `+24`, `-1`, `0`. */
export function signedQty(value: number): string {
  return value > 0 ? `+${formatCount(value)}` : formatCount(value);
}

/**
 * The Sell tile badge from the cached level (Inventory → Sell tile badges):
 * `Out` when qty ≤ 0, `Low · 3 left` at or below the reorder level, else none.
 */
export function stockBadge(qty: number, reorderLevel: number | null): { label: string; variant: ChipVariant; spoken: string } | null {
  if (qty <= 0) return { label: 'Out', variant: 'cancelled', spoken: 'out of stock' };
  if (reorderLevel !== null && qty <= reorderLevel) {
    return { label: `Low · ${formatCount(qty)} left`, variant: 'caution', spoken: `low stock, ${formatCount(qty)} left` };
  }
  return null;
}
