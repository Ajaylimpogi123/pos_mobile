/**
 * The product stock dialogs (Inventory → Product detail → Actions,
 * `inventory.adjust`), with the tablet's wording:
 * - **Stock in:** quantity, unit cost in pesos (prefilled from the product cost), optional note.
 * - **Count:** counted quantity and a reason.
 * - **Wastage:** quantity and a reason quick pick (`Other…` asks for the reason).
 * - **Adjust stock:** add or remove, quantity and a reason.
 * - **Reorder level:** a whole number, or **Remove**.
 * Submit is disabled in flight; after a network error the fields lock and the
 * button becomes **Retry** (the same body, the same ULID).
 */
import { LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { Segmented } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, MoneyInput } from '@/components/ui/input';
import { WASTAGE_PICKS } from '@/constants/inventoryLabels';
import { STOCK_LIMITS, type ReorderLevelDialogState, type StockDialogKind, type StockDialogState } from '@/hooks/useInventory';
import type { InventoryItem } from '@/services/types';
import { formatQty } from '@pos/core/quantity';

const COPY: Record<StockDialogKind, { title: string; confirm: string; qtyLabel: string; placeholder: string }> = {
  receipt: { title: 'Stock in', confirm: 'Save stock in', qtyLabel: 'Quantity received', placeholder: 'e.g. 24' },
  count: { title: 'Count', confirm: 'Save count', qtyLabel: 'Counted quantity on hand', placeholder: 'e.g. 33' },
  wastage: { title: 'Wastage', confirm: 'Save wastage', qtyLabel: 'Quantity wasted', placeholder: 'e.g. 2' },
  adjustment: { title: 'Adjust stock', confirm: 'Save adjustment', qtyLabel: 'Quantity', placeholder: 'e.g. 5' },
};

const DIRECTIONS = [
  { value: 'add' as const, label: 'Add' },
  { value: 'remove' as const, label: 'Remove' },
];

export function SubmitContent({ busy, locked, label }: { busy: boolean; locked: boolean; label: string }) {
  return (
    <>
      {busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : locked ? <RotateCwIcon aria-hidden="true" /> : null}
      {busy ? 'Saving…' : locked ? 'Retry' : label}
    </>
  );
}

export function ProductStockDialog({ dialog, item }: { dialog: StockDialogState; item: InventoryItem }) {
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
            {item.name}: {formatQty(item.qty)} on hand.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={dialog.busy}>
          <ErrorSummary />
          {dialog.banner ? <Banner>{dialog.banner}</Banner> : null}
          {dialog.kind === 'adjustment' ? (
            <Segmented label="Direction" value={dialog.fields.direction} options={DIRECTIONS} onChange={dialog.setDirection} disabled={disabled} />
          ) : null}
          <FormField label={copy.qtyLabel} error={dialog.errors.qty}>
            <Input
              autoFocus
              inputMode="numeric"
              value={dialog.fields.qty}
              placeholder={copy.placeholder}
              onChange={(event) => dialog.setQty(event.target.value)}
              disabled={disabled}
              className="tabular"
            />
          </FormField>
          {dialog.kind === 'receipt' ? (
            <FormField label="Unit cost" error={dialog.errors.unitCost} hint="Recorded on this stock in only; the product's cost doesn't change.">
              <MoneyInput value={dialog.fields.unitCost} placeholder="0.00" onChange={(event) => dialog.setUnitCost(event.target.value)} disabled={disabled} />
            </FormField>
          ) : null}
          {dialog.kind === 'wastage' ? (
            <div className="flex flex-col gap-2">
              <Segmented
                label="Reason"
                value={dialog.fields.pick ?? ''}
                options={WASTAGE_PICKS}
                onChange={(pick) => dialog.setPick(pick)}
                disabled={disabled}
              />
              {dialog.fields.pick === 'other' ? (
                <FormField label="Other reason" error={dialog.errors.reason}>
                  <Input value={dialog.fields.reason} maxLength={STOCK_LIMITS.reasonMax} onChange={(event) => dialog.setReason(event.target.value)} disabled={disabled} />
                </FormField>
              ) : (
                <FieldError message={dialog.errors.reason} />
              )}
            </div>
          ) : (
            <FormField label={dialog.kind === 'receipt' ? 'Note (optional)' : 'Reason'} error={dialog.errors.reason}>
              <Input
                value={dialog.fields.reason}
                maxLength={STOCK_LIMITS.reasonMax}
                placeholder={dialog.kind === 'receipt' ? 'e.g. Delivery from supplier' : 'e.g. Monthly count'}
                onChange={(event) => dialog.setReason(event.target.value)}
                disabled={disabled}
              />
            </FormField>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dialog.close} disabled={dialog.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={dialog.busy}>
              <SubmitContent busy={dialog.busy} locked={dialog.locked} label={copy.confirm} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProductReorderDialog({ dialog, item }: { dialog: ReorderLevelDialogState; item: InventoryItem }) {
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    dialog.save();
  }
  return (
    <Dialog open={dialog.open} onOpenChange={(open) => (open ? null : dialog.close())}>
      <DialogContent hideClose={dialog.busy !== null}>
        <DialogHeader>
          <DialogTitle>Reorder level</DialogTitle>
          <DialogDescription>{item.name} shows as Low at or below this quantity. Remove it to turn the alert off.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={dialog.busy !== null}>
          <ErrorSummary />
          {dialog.banner ? <Banner>{dialog.banner}</Banner> : null}
          <FormField label="Reorder level" error={dialog.error} hint={`A whole number from 0 to ${formatQty(STOCK_LIMITS.reorderMax)}.`}>
            <Input autoFocus inputMode="numeric" value={dialog.text} onChange={(event) => dialog.setText(event.target.value)} className="tabular" />
          </FormField>
          <DialogFooter>
            {dialog.canRemove ? (
              <Button type="button" variant="destructive" onClick={dialog.remove} disabled={dialog.busy !== null} className="sm:mr-auto">
                {dialog.busy === 'remove' ? 'Removing…' : 'Remove'}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={dialog.close} disabled={dialog.busy !== null}>
              Cancel
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={dialog.busy !== null}>
              {dialog.busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
