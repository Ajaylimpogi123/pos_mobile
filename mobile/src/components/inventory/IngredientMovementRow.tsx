import { memo } from 'react';

import { ingredientMovementLabel, isRefundWaste, revaluationLabel } from '@/components/inventory/inventoryLabels';
import { MovementRowView } from '@/components/inventory/MovementRow';
import type { IngredientMovement } from '@/services/types';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';
import { formatQty, toScaled } from '@/utils/quantity';

type IngredientMovementRowProps = {
  movement: IngredientMovement;
  baseUnit: string;
  timeZone: string;
  /** Opens a sale / void / refund's order (`undefined`: plain text). */
  onOpenOrder?: (orderUlid: string) => void;
  /** Opens a receipt's purchase order (`undefined`: plain text). */
  onOpenPurchaseOrder?: (poUlid: string) => void;
};

/** `+25,000 g`, `-240 g`. */
function signedBaseQty(value: IngredientMovement['qty_delta'], unit: string): string {
  const scaled = toScaled(value) ?? 0n;
  return `${scaled > 0n ? '+' : ''}${formatQty(value)} ${unit}`;
}

/** `+₱1,200.00` / `-₱11.20`. */
function signedPeso(cents: number): string {
  return cents > 0 ? `+${formatPeso(cents)}` : formatPeso(cents);
}

/**
 * One ingredient movement (§L: "history with the entered qty and unit
 * shown"): the signed base quantity, `→ 30,000 g on hand`, who and when, the
 * reason, **what was entered** (`Entered 1 sack`), the value moved, and the
 * order or purchase-order reference. §J recipe depletion reads as `Used · sale`,
 * `Returned · void` and `Wasted · refund` (a refund's waste: its quantity is the
 * entered wasted amount, since the entry moves no stock). A §D1 `revaluation`
 * reads `Cost set · ₱1,250.00 / sack` and shows its value change instead of a
 * quantity (it moves no stock).
 */
export const IngredientMovementRow = memo(function IngredientMovementRow({ movement, baseUnit, timeZone, onOpenOrder, onOpenPurchaseOrder }: IngredientMovementRowProps) {
  const when = formatBranchDateTime(movement.occurred_at, timeZone) ?? movement.occurred_at;
  const who = movement.created_by?.name;
  const reference = movement.reference;
  const revaluation = movement.type === 'revaluation';
  // Q-031: a refund's waste moves no stock (`qty_delta` 0); the wasted amount is what was "entered".
  const refundWaste = isRefundWaste(movement.type, reference?.kind ?? null) && movement.entered_qty !== null && Boolean(movement.entered_unit);
  const details: { key: string; text: string }[] = [];
  if (movement.entered_qty !== null && movement.entered_unit && !refundWaste && !revaluation) {
    details.push({ key: 'entered', text: `Entered ${formatQty(movement.entered_qty)} ${movement.entered_unit}` });
  }
  if (!revaluation) details.push({ key: 'value', text: `Value ${signedPeso(movement.value_cents)}` });

  let open: (() => void) | undefined;
  if (reference?.kind === 'purchase_order' && onOpenPurchaseOrder) open = () => onOpenPurchaseOrder(reference.ulid);
  else if (reference && reference.kind !== 'purchase_order' && onOpenOrder) open = () => onOpenOrder(reference.ulid);

  let qtyText = signedBaseQty(movement.qty_delta, baseUnit);
  if (revaluation) qtyText = signedPeso(movement.value_cents);
  else if (refundWaste) qtyText = `${formatQty(movement.entered_qty ?? 0)} ${movement.entered_unit ?? baseUnit}`;

  return (
    <MovementRowView
      id={movement.ulid}
      type={movement.type}
      label={
        revaluation
          ? revaluationLabel(movement.unit_cost_cents, movement.entered_unit)
          : ingredientMovementLabel(movement.type, reference?.kind ?? null)
      }
      qtyText={qtyText}
      afterText={`→ ${formatQty(movement.qty_after)} ${baseUnit} on hand`}
      metaText={who ? `${who} · ${when}` : when}
      reason={movement.reason}
      details={details}
      reference={
        reference
          ? {
              label: reference.label,
              spoken: reference.kind === 'purchase_order' ? `Open purchase order ${reference.label}` : `Open order ${reference.label}`,
              onOpen: open,
            }
          : null
      }
    />
  );
});
