/**
 * Inventory wording (Inventory (v1 completion), Ingredients §B/§D/§D1/§J).
 * Mirrors the tablet's `mobile/src/components/inventory/inventoryLabels.ts`
 * word for word; only the chip variants become the web's MASTER §1.3 status
 * tones and the icons become lucide icons. The offline message is left out
 * (the web is online-only).
 */
import {
  ArrowDownToLine,
  ArrowUpDown,
  ClipboardList,
  Flag,
  ShoppingCart,
  Tag,
  Trash2,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { BadgeTone } from '@/components/ui/badge';
import type { DecimalValue, Ingredient, IngredientMovementType, StockMovementType, StockStatus } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { costDisplayUnit, costForBaseUnits, formatQty, toScaled } from '@pos/core/quantity';

export type StatusTone = Exclude<BadgeTone, 'neutral' | 'outline'>;
export type StatusInfo = { label: string; tone: StatusTone };

/** The status badge: `In stock` OK, `Low` needs attention, `Out` stopped. */
export const STOCK_STATUS: Record<StockStatus, StatusInfo> = {
  in_stock: { label: 'In stock', tone: 'success' },
  low: { label: 'Low', tone: 'warning' },
  out: { label: 'Out', tone: 'danger' },
};

/** `Reorder at 10`, or `No reorder level` (a product). */
export function reorderText(level: number | null): string {
  return level === null ? 'No reorder level' : `Reorder at ${formatQty(level)}`;
}

/** `Reorder at 5,000 g`, or `No reorder level` (an ingredient, in its base unit). */
export function ingredientReorderText(ingredient: Pick<Ingredient, 'reorder_level' | 'base_unit'>): string {
  return ingredient.reorder_level === null ? 'No reorder level' : `Reorder at ${formatQty(ingredient.reorder_level)} ${ingredient.base_unit}`;
}

/** `₱46.67 / kg` from `avg_cost` (centavos per base unit), rounded half up; `—` when it can't be read. */
export function averageCostText(ingredient: Pick<Ingredient, 'avg_cost' | 'base_unit'>): string {
  const per = costDisplayUnit(ingredient.base_unit);
  const cents = costForBaseUnits(ingredient.avg_cost, per.baseUnits);
  return cents === null ? '—' : `${formatPeso(cents)} / ${per.unit}`;
}

/** Each movement type's label and icon, in the order of the history's type filter. */
export const MOVEMENT_TYPES: readonly { value: StockMovementType; label: string; icon: LucideIcon }[] = [
  { value: 'receipt', label: 'Stock in', icon: ArrowDownToLine },
  { value: 'sale', label: 'Sale', icon: ShoppingCart },
  { value: 'void', label: 'Void', icon: XCircle },
  { value: 'refund', label: 'Refund', icon: Undo2 },
  { value: 'wastage', label: 'Wastage', icon: Trash2 },
  { value: 'count', label: 'Count', icon: ClipboardList },
  { value: 'adjustment', label: 'Adjustment', icon: ArrowUpDown },
  { value: 'opening', label: 'Opening', icon: Flag },
];

/** §D1: the ingredient-only `revaluation` (a manual cost); ingredient histories filter by it too. */
const REVALUATION_TYPE = { value: 'revaluation' as const, label: 'Cost set', icon: Tag };

/** An ingredient history's type filter: the product types plus `revaluation`. */
export const INGREDIENT_MOVEMENT_TYPES: readonly { value: IngredientMovementType; label: string; icon: LucideIcon }[] = [
  ...MOVEMENT_TYPES,
  REVALUATION_TYPE,
];

const BY_TYPE = new Map<string, { label: string; icon: LucideIcon }>(INGREDIENT_MOVEMENT_TYPES.map((entry) => [entry.value, entry]));

/** The label and icon of a movement type (an unknown type from a newer server reads as an adjustment). */
export function movementTypeInfo(type: string): { label: string; icon: LucideIcon } {
  return BY_TYPE.get(type) ?? { label: 'Adjustment', icon: ArrowUpDown };
}

/** Q-031: a refund's recipe waste (`wastage`, `qty_delta` 0, the wasted amount in `entered_qty` + `entered_unit`). */
export function isRefundWaste(type: string, referenceKind: string | null): boolean {
  return type === 'wastage' && referenceKind === 'refund';
}

/**
 * §J: how an ingredient's recipe movements read in its history: a sale
 * **used** it, a void **returned** it, and a refund's share was **wasted**.
 * Every other type reads as in `MOVEMENT_TYPES`.
 */
export function ingredientMovementLabel(type: string, referenceKind: string | null): string {
  if (type === 'sale') return 'Used · sale';
  if (type === 'void') return 'Returned · void';
  if (isRefundWaste(type, referenceKind)) return 'Wasted · refund';
  return movementTypeInfo(type).label;
}

/** §D1: `Cost set · ₱1,250.00 / sack`, or `Cost set` when either part is missing. */
export function revaluationLabel(unitCostCents: number | null, enteredUnit: string | null): string {
  if (unitCostCents === null || !Number.isSafeInteger(unitCostCents) || !enteredUnit) return REVALUATION_TYPE.label;
  return `${REVALUATION_TYPE.label} · ${formatPeso(unitCostCents)} / ${enteredUnit}`;
}

/** A signed product quantity: `+24`, `-1`, `0`. */
export function signedQty(value: number): string {
  return value > 0 ? `+${formatQty(value)}` : formatQty(value);
}

/** A signed ingredient quantity in its base unit: `+25,000 g`, `-240 g`. */
export function signedBaseQty(value: DecimalValue, unit: string): string {
  const scaled = toScaled(value) ?? 0n;
  return `${scaled > 0n ? '+' : ''}${formatQty(value)} ${unit}`;
}

/** `+₱1,200.00` / `-₱11.20`. */
export function signedPeso(cents: number): string {
  return cents > 0 ? `+${formatPeso(cents)}` : formatPeso(cents);
}

/** Wastage quick picks (`other` shows a text field). */
export const WASTAGE_PICKS: readonly { value: string; label: string }[] = [
  { value: 'Spoiled', label: 'Spoiled' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Damaged', label: 'Damaged' },
  { value: 'other', label: 'Other…' },
];
