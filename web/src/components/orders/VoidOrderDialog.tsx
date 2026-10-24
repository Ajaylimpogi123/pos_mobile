/**
 * The **Void sale** dialog (Voids & Refunds → Void dialog; MASTER §3: a
 * destructive confirmation names the action and uses the destructive colour):
 * a required reason with quick picks, the manager approval when needed, then
 * the result ("Sale voided. Give back ₱157.00 cash") with the print status of
 * the void slip and the VOID kitchen tickets.
 */
import { BanIcon, CircleCheckIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { VoidOrderState } from '@/hooks/useVoidOrder';
import { cn } from '@/lib/utils';
import type { Order } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { OTHER_REASON, VOID_REASONS } from '@pos/core/sale/reversals';

import { ApproverPicker } from './ApproverPicker';

const CHOICES: readonly string[] = [...VOID_REASONS, OTHER_REASON];

export function VoidOrderDialog({ order, state }: { order: Order; state: VoidOrderState }) {
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    state.confirm();
  }

  return (
    <Dialog open={state.open} onOpenChange={(open) => (open ? null : state.close())}>
      <DialogContent hideClose={state.submitting} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{state.done ? 'Sale voided' : `Void sale ${order.invoice_no}`}</DialogTitle>
          <DialogDescription>
            {state.done
              ? 'The void slip prints on this terminal’s receipt printer, and the kitchen is told not to prepare it.'
              : `The whole sale (${formatPeso(order.total_cents)}) is cancelled and its stock goes back. This can’t be undone.`}
          </DialogDescription>
        </DialogHeader>

        {state.done ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 rounded-xl border border-success-border bg-success-bg p-4 text-success" role="status">
              {state.done.lines.map((line) => (
                <p key={line} className="flex items-center gap-2 text-base font-bold">
                  <CircleCheckIcon className="size-5 shrink-0" aria-hidden="true" />
                  {line}
                </p>
              ))}
            </div>
            <PrintJobList tracker={state.printing.tracker} notices={state.printing.notices} unrouted={state.printing.unrouted} title="Printing" />
            <DialogFooter>
              <Button variant="green" size="lg" onClick={state.close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={state.submitting}>
            <ErrorSummary />
            {state.banner ? <Banner variant={state.banner.variant}>{state.banner.message}</Banner> : null}

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
              {state.choice !== OTHER_REASON ? <FieldError message={state.reasonError} /> : null}
            </fieldset>

            {state.choice === OTHER_REASON ? (
              <FormField label="Reason in your words" error={state.reasonError}>
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
                Cancel
              </Button>
              <Button type="submit" variant="destructiveSolid" size="lg" disabled={!state.canConfirm}>
                {state.submitting ? (
                  <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                ) : state.awaiting ? (
                  <RotateCwIcon aria-hidden="true" />
                ) : (
                  <BanIcon aria-hidden="true" />
                )}
                {state.submitting ? 'Voiding…' : state.awaiting ? 'Retry' : state.needsApproval ? 'Approve and void sale' : 'Void sale'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
