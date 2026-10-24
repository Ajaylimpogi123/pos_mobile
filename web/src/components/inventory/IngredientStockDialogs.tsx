/**
 * The ingredient stock dialogs (§D, §D1, §L; `inventory.adjust`), with the
 * tablet's wording:
 * - **Adjust stock** (add or remove), **Count**, **Wastage** (reason quick
 *   picks): a quantity with a unit picker and its base preview, and a reason;
 * - **Reorder level** in any valid unit, or **Remove**;
 * - **Set cost**: the price of one unit (any valid unit, default the base
 *   unit), an optional reason, and the live cost per base unit and stock
 *   value it gives (exact `BigInt` math, as the server's).
 * After a network error the fields lock and the button becomes **Retry**.
 */
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { SubmitContent } from '@/components/inventory/ProductStockDialogs';
import { Segmented } from '@/components/sell/SellParts';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { UnitSelect } from '@/components/units/UnitSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, MoneyInput } from '@/components/ui/input';
import { WASTAGE_PICKS } from '@/constants/inventoryLabels';
import {
  REASON_MAX,
  costRateTexts,
  type IngredientCostDialogState,
  type IngredientReorderDialogState,
  type IngredientStockDialogState,
  type IngredientStockKind,
} from '@/hooks/useIngredientStock';
import type { Ingredient } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatQty } from '@pos/core/quantity';

const COPY: Record<IngredientStockKind, { title: string; confirm: string; qtyLabel: string }> = {
  adjustment: { title: 'Adjust stock', confirm: 'Save adjustment', qtyLabel: 'Quantity' },
  count: { title: 'Count', confirm: 'Save count', qtyLabel: 'Counted quantity on hand' },
  wastage: { title: 'Wastage', confirm: 'Save wastage', qtyLabel: 'Quantity wasted' },
};

const DIRECTIONS = [
  { value: 'add' as const, label: 'Add' },
  { value: 'remove' as const, label: 'Remove' },
];

export function IngredientStockDialog({ dialog, item }: { dialog: IngredientStockDialogState; item: Ingredient }) {
  const copy = COPY[dialog.kind];
  const disabled = dialog.busy || dialog.locked;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    dialog.submit();
  }

  return (
    <Dialog open={dialog.open} onOpenChange={(open) => (open ? null : dialog.close())}>
      <DialogContent hideClose={dialog.busy}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {item.name}: {formatQty(item.qty)} {item.base_unit} on hand.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={dialog.busy}>
          <ErrorSummary />
          {dialog.banner ? <Banner>{dialog.banner}</Banner> : null}
          {dialog.kind === 'adjustment' ? (
            <Segmented label="Direction" value={dialog.fields.direction} options={DIRECTIONS} onChange={dialog.setDirection} disabled={disabled} />
          ) : null}
          <QtyUnitField
            label={copy.qtyLabel}
            qty={dialog.fields.qty}
            unit={dialog.fields.unit}
            choices={dialog.choices}
            onQty={dialog.setQty}
            onUnit={dialog.setUnit}
            qtyError={dialog.errors.qty}
            unitError={dialog.errors.unit}
            disabled={disabled}
            allowZero={dialog.kind === 'count'}
          />
          {dialog.kind === 'wastage' ? (
            <div className="flex flex-col gap-2">
              <Segmented label="Reason" value={dialog.fields.pick ?? ''} options={WASTAGE_PICKS} onChange={(pick) => dialog.setPick(pick)} disabled={disabled} />
              {dialog.fields.pick === 'other' ? (
                <FormField label="Other reason" error={dialog.errors.reason}>
                  <Input value={dialog.fields.reason} maxLength={REASON_MAX} onChange={(event) => dialog.setReason(event.target.value)} disabled={disabled} />
                </FormField>
              ) : (
                <FieldError message={dialog.errors.reason} />
              )}
            </div>
          ) : (
            <FormField label="Reason" error={dialog.errors.reason}>
              <Input
                value={dialog.fields.reason}
                maxLength={REASON_MAX}
                placeholder={dialog.kind === 'count' ? 'e.g. Monthly count' : 'e.g. Found an extra sack'}
                onChange={(event) => dialog.setReason(event.target.value)}
                disabled={disabled}
              />
            </FormField>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dialog.close} disabled={dialog.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={dialog.busy || !dialog.choices}>
              <SubmitContent busy={dialog.busy} locked={dialog.locked} label={copy.confirm} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IngredientReorderDialog({ dialog, item }: { dialog: IngredientReorderDialogState; item: Ingredient }) {
  const busy = dialog.busy !== null;
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    dialog.save();
  }
  return (
    <Dialog open={dialog.open} onOpenChange={(open) => (open ? null : dialog.close())}>
      <DialogContent hideClose={busy}>
        <DialogHeader>
          <DialogTitle>Reorder level</DialogTitle>
          <DialogDescription>{item.name} shows as Low at or below this quantity. Remove it to turn the alert off.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={busy}>
          <ErrorSummary />
          {dialog.banner ? <Banner>{dialog.banner}</Banner> : null}
          <QtyUnitField
            label="Reorder level"
            qty={dialog.qty}
            unit={dialog.unit}
            choices={dialog.choices}
            onQty={dialog.setQty}
            onUnit={dialog.setUnit}
            qtyError={dialog.errors.qty}
            unitError={dialog.errors.unit}
            disabled={busy}
            allowZero
          />
          <DialogFooter>
            {dialog.canRemove ? (
              <Button type="button" variant="destructive" onClick={dialog.remove} disabled={busy} className="sm:mr-auto">
                {dialog.busy === 'remove' ? 'Removing…' : 'Remove'}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={dialog.close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={busy}>
              {dialog.busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IngredientCostDialog({ dialog, item }: { dialog: IngredientCostDialogState; item: Ingredient }) {
  const disabled = dialog.busy || dialog.locked;
  const current = costRateTexts(item.avg_cost, item.base_unit);
  const preview = dialog.preview;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    dialog.submit();
  }

  return (
    <Dialog open={dialog.open} onOpenChange={(open) => (open ? null : dialog.close())}>
      <DialogContent hideClose={dialog.busy}>
        <DialogHeader>
          <DialogTitle>Set cost</DialogTitle>
          <DialogDescription>
            The price of one unit of {item.name}. Now {current.perLarger ?? current.perBase}. Receipts keep re-weighting it afterwards.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={dialog.busy}>
          <ErrorSummary />
          {dialog.banner ? <Banner>{dialog.banner}</Banner> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <FormField label="Cost" error={dialog.errors.cost_cents}>
              <MoneyInput autoFocus value={dialog.fields.amount} placeholder="0.00" onChange={(event) => dialog.setAmount(event.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="Per" error={dialog.errors.unit}>
              <UnitSelect className="w-40" choices={dialog.choices} value={dialog.fields.unit} onChange={dialog.setUnit} disabled={disabled} />
            </FormField>
          </div>
          <div aria-live="polite" className="rounded-lg border border-border bg-subtle p-3 text-sm">
            {preview ? (
              <div className="flex flex-col gap-1">
                <p className="font-semibold tabular">
                  New cost {preview.perBase}
                  {preview.perLarger ? ` (${preview.perLarger})` : ''}
                </p>
                {preview.valueFrom !== null && preview.valueTo !== null ? (
                  <p className="text-muted-foreground tabular">
                    Stock value {formatPeso(preview.valueFrom)} → {formatPeso(preview.valueTo)}
                  </p>
                ) : null}
                {preview.tooSmall ? <p className="font-medium text-danger">The cost is too small for this unit.</p> : null}
              </div>
            ) : (
              <p className="text-muted-foreground">Enter the cost to see the cost per {item.base_unit}.</p>
            )}
          </div>
          <FormField label="Reason (optional)" error={dialog.errors.reason}>
            <Input
              value={dialog.fields.reason}
              maxLength={REASON_MAX}
              placeholder="e.g. Supplier price list"
              onChange={(event) => dialog.setReason(event.target.value)}
              disabled={disabled}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dialog.close} disabled={dialog.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={dialog.busy || !dialog.choices}>
              <SubmitContent busy={dialog.busy} locked={dialog.locked} label="Save cost" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
