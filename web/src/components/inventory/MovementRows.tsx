/**
 * The movement history rows (Inventory → Product detail → History; §L
 * ingredient history). Each row: the type icon and label, the signed
 * quantity, `→ 33 on hand`, who and when (branch time), the reason, the extra
 * details (unit cost, entered qty, value), and the reference (an order or a
 * purchase order), which opens it when the user may.
 */
import { Link } from 'react-router';

import { cn } from '@/lib/utils';
import {
  ingredientMovementLabel,
  isRefundWaste,
  movementTypeInfo,
  revaluationLabel,
  signedBaseQty,
  signedPeso,
  signedQty,
} from '@/constants/inventoryLabels';
import type { IngredientMovement, InventoryMovement } from '@/services/types';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatQty, toScaled } from '@pos/core/quantity';

type RowViewProps = {
  type: string;
  label: string;
  qtyText: string;
  negative: boolean;
  afterText: string;
  metaText: string;
  reason: string | null;
  details: string[];
  reference: { label: string; onOpen?: () => void; to?: string; spoken: string } | null;
};

function MovementRowView({ type, label, qtyText, negative, afterText, metaText, reason, details, reference }: RowViewProps) {
  const Icon = movementTypeInfo(type).icon;
  return (
    <li className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="font-semibold">{label}</p>
          <p className={cn('text-base font-bold tabular', negative ? 'text-danger' : 'text-green')}>{qtyText}</p>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-muted-foreground">
          <span>{metaText}</span>
          <span className="tabular">{afterText}</span>
        </div>
        {reason ? <p className="text-sm">{reason}</p> : null}
        {details.length > 0 ? <p className="text-[13px] text-muted-foreground tabular">{details.join(' · ')}</p> : null}
        {reference ? (
          reference.to ? (
            <Link to={reference.to} className="w-fit text-sm font-medium text-green underline-offset-4 hover:underline" aria-label={reference.spoken}>
              {reference.label}
            </Link>
          ) : reference.onOpen ? (
            <button
              type="button"
              onClick={reference.onOpen}
              className="w-fit text-left text-sm font-medium text-green underline-offset-4 hover:underline"
              aria-label={reference.spoken}
            >
              {reference.label}
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">{reference.label}</p>
          )
        ) : null}
      </div>
    </li>
  );
}

/** One product movement: `+24`, `→ 33 on hand`, the unit cost of a stock in, the order reference. */
export function ProductMovementRow({
  movement,
  timeZone,
  onOpenOrder,
}: {
  movement: InventoryMovement;
  timeZone: string;
  onOpenOrder?: (orderUlid: string) => void;
}) {
  const when = formatBranchDateTime(movement.occurred_at, timeZone) ?? movement.occurred_at;
  const who = movement.created_by?.name;
  const reference = movement.reference;
  return (
    <MovementRowView
      type={movement.type}
      label={movementTypeInfo(movement.type).label}
      qtyText={signedQty(movement.qty_delta)}
      negative={movement.qty_delta < 0}
      afterText={`→ ${formatQty(movement.qty_after)} on hand`}
      metaText={who ? `${who} · ${when}` : when}
      reason={movement.reason}
      details={movement.type === 'receipt' && movement.unit_cost_cents !== null ? [`Unit cost ${formatPeso(movement.unit_cost_cents)}`] : []}
      reference={
        reference
          ? { label: reference.label, spoken: `Open order ${reference.label}`, onOpen: onOpenOrder ? () => onOpenOrder(reference.ulid) : undefined }
          : null
      }
    />
  );
}

/**
 * One ingredient movement (§L: "history with the entered qty and unit
 * shown"). §J recipe depletion reads `Used · sale`, `Returned · void` and
 * `Wasted · refund`; a §D1 `revaluation` reads `Cost set · ₱1,250.00 / sack`
 * and shows its value change instead of a quantity.
 */
export function IngredientMovementRow({
  movement,
  baseUnit,
  timeZone,
  onOpenOrder,
  canOpenPurchaseOrder,
}: {
  movement: IngredientMovement;
  baseUnit: string;
  timeZone: string;
  onOpenOrder?: (orderUlid: string) => void;
  canOpenPurchaseOrder: boolean;
}) {
  const when = formatBranchDateTime(movement.occurred_at, timeZone) ?? movement.occurred_at;
  const who = movement.created_by?.name;
  const reference = movement.reference;
  const revaluation = movement.type === 'revaluation';
  // Q-031: a refund's waste moves no stock (`qty_delta` 0); the wasted amount is what was "entered".
  const refundWaste = isRefundWaste(movement.type, reference?.kind ?? null) && movement.entered_qty !== null && Boolean(movement.entered_unit);
  const details: string[] = [];
  if (movement.entered_qty !== null && movement.entered_unit && !refundWaste && !revaluation) {
    details.push(`Entered ${formatQty(movement.entered_qty)} ${movement.entered_unit}`);
  }
  if (!revaluation) details.push(`Value ${signedPeso(movement.value_cents)}`);

  let qtyText = signedBaseQty(movement.qty_delta, baseUnit);
  let negative = (toScaled(movement.qty_delta) ?? 0n) < 0n;
  if (revaluation) {
    qtyText = signedPeso(movement.value_cents);
    negative = movement.value_cents < 0;
  } else if (refundWaste) {
    qtyText = `${formatQty(movement.entered_qty ?? 0)} ${movement.entered_unit ?? baseUnit}`;
    negative = true;
  }

  let ref: RowViewProps['reference'] = null;
  if (reference?.kind === 'purchase_order') {
    ref = {
      label: reference.label,
      spoken: `Open purchase order ${reference.label}`,
      to: canOpenPurchaseOrder ? `/purchasing/orders/${reference.ulid}` : undefined,
    };
  } else if (reference) {
    ref = { label: reference.label, spoken: `Open order ${reference.label}`, onOpen: onOpenOrder ? () => onOpenOrder(reference.ulid) : undefined };
  }

  return (
    <MovementRowView
      type={movement.type}
      label={revaluation ? revaluationLabel(movement.unit_cost_cents, movement.entered_unit) : ingredientMovementLabel(movement.type, reference?.kind ?? null)}
      qtyText={qtyText}
      negative={negative}
      afterText={`→ ${formatQty(movement.qty_after)} ${baseUnit} on hand`}
      metaText={who ? `${who} · ${when}` : when}
      reason={movement.reason}
      details={details}
      reference={ref}
    />
  );
}
