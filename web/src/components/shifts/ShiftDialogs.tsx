/**
 * The shift dialogs (Shifts & Reporting → Device rules): **Cash in / Cash
 * out** (amount and reason) and **Close shift** (counted cash and an optional
 * note, showing expected cash and the variance, then a confirm step). Submit
 * is disabled while a request is in flight; a request that got no answer
 * locks the form and offers **Retry** with the same body.
 */
import { ArrowLeftIcon, LoaderCircleIcon, LockIcon, RotateCwIcon } from 'lucide-react';
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, MoneyInput, Textarea } from '@/components/ui/input';
import type { ShiftActions } from '@/hooks/useShiftActions';
import { SHIFT_LIMITS } from '@/utils/shiftForms';
import { formatPeso } from '@pos/core/money';

import { VarianceLine } from './ShiftReportView';

export function CashMovementDialog({ actions }: { actions: ShiftActions }) {
  const cash = actions.cash;
  const isIn = cash?.type === 'in';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    cash?.submit();
  }

  return (
    <Dialog open={cash !== null} onOpenChange={(open) => (open ? null : actions.dismissCash())}>
      <DialogContent hideClose={cash?.submitting}>
        <DialogHeader>
          <DialogTitle>{isIn ? 'Cash in' : 'Cash out'}</DialogTitle>
          <DialogDescription>
            {isIn ? 'Record cash put into the drawer, with the reason.' : 'Record cash taken out of the drawer, with the reason.'}
          </DialogDescription>
        </DialogHeader>
        {cash ? (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={cash.submitting}>
            <ErrorSummary />
            {cash.banner ? <Banner variant={cash.banner.variant}>{cash.banner.message}</Banner> : null}
            <FormField label="Amount" error={cash.amountError}>
              <MoneyInput
                autoFocus
                value={cash.amount}
                placeholder="0.00"
                onChange={(event) => cash.setAmount(event.target.value)}
                disabled={cash.locked}
                className="h-12 text-lg"
              />
            </FormField>
            <FormField label="Reason" error={cash.reasonError} hint={`Up to ${SHIFT_LIMITS.maxReasonLength} characters.`}>
              <Input
                value={cash.reason}
                maxLength={SHIFT_LIMITS.maxReasonLength}
                placeholder={isIn ? 'e.g. Added change' : 'e.g. Bought ice'}
                onChange={(event) => cash.setReason(event.target.value)}
                disabled={cash.locked}
              />
            </FormField>
            <DialogFooter>
              <Button variant="outline" onClick={actions.dismissCash} disabled={cash.submitting}>
                Cancel
              </Button>
              <Button type="submit" variant="green" size="lg" disabled={cash.submitting}>
                {cash.submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : cash.awaiting ? <RotateCwIcon aria-hidden="true" /> : null}
                {cash.submitting ? 'Saving…' : cash.awaiting ? 'Retry' : isIn ? 'Record cash in' : 'Record cash out'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CloseShiftDialog({ actions }: { actions: ShiftActions }) {
  const close = actions.close;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!close) return;
    if (close.step === 'count') close.review();
    else close.confirm();
  }

  return (
    <Dialog open={close !== null} onOpenChange={(open) => (open ? null : actions.dismissClose())}>
      <DialogContent hideClose={close?.submitting}>
        <DialogHeader>
          <DialogTitle>Close shift</DialogTitle>
          <DialogDescription>
            {close?.step === 'confirm'
              ? 'Check the figures, then close the shift. The Z-read prints on this terminal’s receipt printer.'
              : 'Count the cash in the drawer and enter the total.'}
          </DialogDescription>
        </DialogHeader>
        {close ? (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={close.submitting}>
            <ErrorSummary />
            {close.banner ? <Banner variant={close.banner.variant}>{close.banner.message}</Banner> : null}

            <div className="flex flex-col gap-1.5 rounded-xl bg-subtle p-4">
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <span>Expected cash</span>
                <span className="text-lg font-bold tabular">{close.expectedCents !== null ? formatPeso(close.expectedCents) : '…'}</span>
              </div>
              {close.countedCents !== null ? (
                <div className="flex items-baseline justify-between gap-3 text-[15px]">
                  <span>Counted cash</span>
                  <span className="font-semibold tabular">{formatPeso(close.countedCents)}</span>
                </div>
              ) : null}
              {close.liveVariance !== null ? <VarianceLine varianceCents={close.liveVariance} /> : null}
            </div>

            {close.step === 'count' ? (
              <>
                <FormField label="Counted cash" error={close.countedError}>
                  <MoneyInput
                    autoFocus
                    value={close.counted}
                    placeholder="0.00"
                    onChange={(event) => close.setCounted(event.target.value)}
                    disabled={close.locked}
                    className="h-12 text-lg"
                  />
                </FormField>
                <FormField label="Note (optional)" error={close.noteError} hint={`Up to ${SHIFT_LIMITS.maxCloseNoteLength} characters.`}>
                  <Textarea
                    value={close.note}
                    maxLength={SHIFT_LIMITS.maxCloseNoteLength}
                    onChange={(event) => close.setNote(event.target.value)}
                    disabled={close.locked}
                  />
                </FormField>
              </>
            ) : close.note.trim() !== '' ? (
              <p className="text-sm text-muted-foreground">Note: {close.note.trim()}</p>
            ) : null}

            <DialogFooter>
              {close.step === 'confirm' ? (
                <Button variant="outline" onClick={close.back} disabled={close.locked}>
                  <ArrowLeftIcon aria-hidden="true" />
                  Back
                </Button>
              ) : (
                <Button variant="outline" onClick={actions.dismissClose} disabled={close.submitting}>
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                variant={close.step === 'confirm' ? 'destructiveSolid' : 'green'}
                size="lg"
                disabled={close.submitting || close.expectedCents === null}
              >
                {close.submitting ? (
                  <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                ) : close.awaiting ? (
                  <RotateCwIcon aria-hidden="true" />
                ) : close.step === 'confirm' ? (
                  <LockIcon aria-hidden="true" />
                ) : null}
                {close.submitting ? 'Closing…' : close.awaiting ? 'Retry' : close.step === 'confirm' ? 'Close shift' : 'Continue'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
