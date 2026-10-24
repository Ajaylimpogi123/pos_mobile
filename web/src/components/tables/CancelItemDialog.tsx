/**
 * **Cancel** a sent item (Dine-in Tables & Tabs §D.5; MASTER §3: a
 * destructive confirmation names the action): the quantity, a required
 * reason with the void's quick picks, and the manager approval when the user
 * lacks `sale.void` (the void's approver picker). The VOID kitchen ticket
 * prints after the `200`.
 */
import { BanIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { ApproverPicker } from '@/components/orders/ApproverPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CancelTabItemState } from '@/hooks/useCancelTabItem';
import { cn } from '@/lib/utils';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { OTHER_REASON, VOID_REASONS } from '@pos/core/sale/reversals';

const CHOICES: readonly string[] = [...VOID_REASONS, OTHER_REASON];

export function CancelItemDialog({ state }: { state: CancelTabItemState }) {
  const item = state.item;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    state.confirm();
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => (open ? null : state.close())}>
      <DialogContent hideClose={state.submitting} className="sm:max-w-xl">
        {item ? (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={state.submitting}>
            <ErrorSummary />
            <DialogHeader>
              <DialogTitle>Cancel {item.product_name}</DialogTitle>
              <DialogDescription>
                Round {item.round_no} · {item.remaining_qty} not paid yet. The kitchen gets a VOID ticket for what you cancel.
              </DialogDescription>
            </DialogHeader>

            {state.banner ? <Banner variant={state.banner.variant}>{state.banner.message}</Banner> : null}

            <FormField label="Quantity to cancel" error={state.errors.qty} hint={`1 to ${item.remaining_qty}.`}>
              <Input
                inputMode="numeric"
                value={state.qtyText}
                onChange={(event) => state.setQty(event.target.value)}
                disabled={state.locked}
                className="w-32 tabular"
              />
            </FormField>

            <fieldset className="flex flex-col gap-2" disabled={state.locked}>
              <legend className="mb-1 text-sm font-medium">Reason</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
                {CHOICES.map((choice) => {
                  const selected = state.choice === choice;
                  return (
                    <Button
                      key={choice}
                      role="radio"
                      aria-checked={selected}
                      variant="outline"
                      className={cn(selected && 'border-destructive bg-danger-bg text-danger hover:bg-danger-bg')}
                      onClick={() => state.choose(choice)}
                    >
                      {choice}
                    </Button>
                  );
                })}
              </div>
              {state.choice !== OTHER_REASON ? <FieldError message={state.errors.reason} /> : null}
            </fieldset>

            {state.choice === OTHER_REASON ? (
              <FormField label="Reason in your words" error={state.errors.reason}>
                <Input
                  autoFocus
                  value={state.otherText}
                  maxLength={REVERSAL_REASON_MAX}
                  onChange={(event) => state.setOtherText(event.target.value)}
                  disabled={state.locked}
                />
              </FormField>
            ) : null}

            {state.needsApproval ? <ApproverPicker picker={state.picker} action="void" disabled={state.locked} /> : null}

            <DialogFooter>
              <Button variant="outline" onClick={state.close} disabled={state.submitting}>
                Keep it
              </Button>
              <Button type="submit" variant="destructiveSolid" size="lg" disabled={!state.canConfirm}>
                {state.submitting ? (
                  <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                ) : state.awaiting ? (
                  <RotateCwIcon aria-hidden="true" />
                ) : (
                  <BanIcon aria-hidden="true" />
                )}
                {state.submitting ? 'Cancelling…' : state.awaiting ? 'Retry' : state.needsApproval ? 'Approve and cancel item' : 'Cancel item'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
