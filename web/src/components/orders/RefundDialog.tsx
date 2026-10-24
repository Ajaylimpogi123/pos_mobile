/**
 * The **Refund** dialog (Voids & Refunds → Refund screen, as a dialog over the
 * order detail): the lines with a quantity each (0 to what is left) and
 * **Refund everything**, the amount with its VAT split, the payment split
 * (cash first; GCash needs the reference), the reason, the manager approval
 * when needed, then the result ("Refund done. Give back ₱33.69 cash") with
 * the refund slip's print status.
 */
import { CircleCheckIcon, LoaderCircleIcon, MinusIcon, PlusIcon, RotateCwIcon, Undo2Icon } from 'lucide-react';
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, MoneyInput } from '@/components/ui/input';
import type { RefundOrderState } from '@/hooks/useRefundOrder';
import type { Order } from '@/services/types';
import { SHOW_VAT_BREAKDOWN } from '@pos/core/features';
import { formatPeso } from '@pos/core/money';
import { formatPercentValue } from '@pos/core/sale/discountRules';
import { VAT_RATE_BPS } from '@pos/core/sale/pricing';
import { REFUND_REFERENCE_MAX, REVERSAL_REASON_MAX, remainingQty } from '@pos/core/sale/refunds';

import { ApproverPicker } from './ApproverPicker';

function Money({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between gap-3 text-lg font-bold' : 'flex justify-between gap-3 text-sm text-muted-foreground'}>
      <span>{label}</span>
      <span className={strong ? 'text-green tabular' : 'tabular'}>{formatPeso(cents)}</span>
    </div>
  );
}

export function RefundDialog({ order, state }: { order: Order; state: RefundOrderState }) {
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    state.submit();
  }

  const errors = state.splitErrors ?? {};
  const server = state.serverErrors;

  return (
    <Dialog open={state.open} onOpenChange={(open) => (open ? null : state.close())}>
      <DialogContent hideClose={state.submitting} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{state.done ? 'Refund done' : `Refund ${order.invoice_no}`}</DialogTitle>
          <DialogDescription>
            {state.done
              ? 'The refund slip prints on this terminal’s receipt printer.'
              : 'Choose what goes back. Money goes back the way it was paid; cash comes out of this terminal’s drawer.'}
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
            <PrintJobList tracker={state.printing.tracker} notices={state.printing.notices} title="Printing" />
            <DialogFooter>
              <Button variant="green" size="lg" onClick={state.close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate aria-busy={state.submitting}>
            <ErrorSummary />
            {state.blocker ? <Banner variant="warning">{state.blocker}</Banner> : null}
            {state.banner ? <Banner variant={state.banner.variant}>{state.banner.message}</Banner> : null}

            <section aria-label="Lines" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">What goes back</h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={state.refundEverything} disabled={state.locked}>
                    Refund everything
                  </Button>
                  <Button variant="ghost" size="sm" onClick={state.clearLines} disabled={state.locked}>
                    Clear
                  </Button>
                </div>
              </div>
              {server.items ? <FieldError message={server.items} /> : null}
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {state.lines.map((item) => {
                  const left = remainingQty(item);
                  const qty = state.selection[item.id] ?? 0;
                  const line = state.pricing.lines.find((entry) => entry.item.id === item.id);
                  const qtyId = `refund-qty-${item.id}`;
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <label htmlFor={qtyId} className="font-medium">
                          {item.product_name}
                        </label>
                        <p className="text-[13px] text-muted-foreground">
                          {left} of {item.qty} left · line {formatPeso(item.line_total_cents)}
                          {item.refunded_qty > 0 ? ` · ${item.refunded_qty} refunded` : ''}
                        </p>
                        <FieldError message={server.lines[item.id]} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`One less ${item.product_name}`}
                          onClick={() => state.setQty(item.id, qty - 1)}
                          disabled={state.locked || qty <= 0}
                        >
                          <MinusIcon aria-hidden="true" />
                        </Button>
                        <Input
                          id={qtyId}
                          inputMode="numeric"
                          value={String(qty)}
                          onChange={(event) => {
                            const value = Number(event.target.value.replace(/\D/g, '') || '0');
                            state.setQty(item.id, value);
                          }}
                          disabled={state.locked}
                          className="w-14 text-center tabular"
                          aria-describedby={`${qtyId}-max`}
                        />
                        <span id={`${qtyId}-max`} className="sr-only">
                          Up to {left}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`One more ${item.product_name}`}
                          onClick={() => state.setQty(item.id, qty + 1)}
                          disabled={state.locked || qty >= left}
                        >
                          <PlusIcon aria-hidden="true" />
                        </Button>
                      </div>
                      <span className="w-24 text-right font-semibold tabular">{line ? formatPeso(line.amount_cents) : '—'}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-label="Refund amount" className="flex flex-col gap-1.5 rounded-xl bg-subtle p-4">
              {state.pricing.service_charge_cents > 0 ? <Money label="Service charge" cents={state.pricing.service_charge_cents} /> : null}
              <Money label={`Refund (${state.pricing.units} ${state.pricing.units === 1 ? 'item' : 'items'})`} cents={state.pricing.amount_cents} strong />
              {SHOW_VAT_BREAKDOWN ? (
                <>
                  <Money label="VATable sales" cents={state.pricing.vatable_sales_cents} />
                  <Money label={`VAT ${formatPercentValue(VAT_RATE_BPS)}`} cents={state.pricing.vat_amount_cents} />
                  <Money label="VAT-exempt sales" cents={state.pricing.vat_exempt_sales_cents} />
                </>
              ) : null}
              <FieldError message={server.checksum} />
            </section>

            {state.pricing.amount_cents > 0 ? (
              <section aria-label="Money back" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Money back</h3>
                  <Button variant="ghost" size="sm" onClick={state.resetSplit} disabled={state.locked}>
                    Cash first
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Cash" error={errors.cash ?? server.cash} hint={`${formatPeso(state.methodsLeft.cash)} paid by cash is left`}>
                    <MoneyInput
                      value={state.draft.cash}
                      placeholder="0.00"
                      onChange={(event) => state.setCash(event.target.value)}
                      disabled={state.locked || state.methodsLeft.cash === 0}
                    />
                  </FormField>
                  <FormField label="GCash" error={errors.gcash ?? server.gcash} hint={`${formatPeso(state.methodsLeft.gcash)} paid by GCash is left`}>
                    <MoneyInput
                      value={state.draft.gcash}
                      placeholder="0.00"
                      onChange={(event) => state.setGcash(event.target.value)}
                      disabled={state.locked || state.methodsLeft.gcash === 0}
                    />
                  </FormField>
                </div>
                {state.split.gcashCents > 0 ? (
                  <FormField label="GCash reference (the transfer back)" error={errors.reference ?? server.reference}>
                    <Input
                      value={state.draft.reference}
                      maxLength={REFUND_REFERENCE_MAX}
                      onChange={(event) => state.setReference(event.target.value)}
                      disabled={state.locked}
                      autoComplete="off"
                    />
                  </FormField>
                ) : null}
                <FieldError message={errors.general ?? server.payments} />
              </section>
            ) : null}

            <FormField label="Reason" error={state.reasonError}>
              <Input
                value={state.reasonText}
                maxLength={REVERSAL_REASON_MAX}
                placeholder="e.g. Wrong drink"
                onChange={(event) => state.setReasonText(event.target.value)}
                disabled={state.locked}
              />
            </FormField>

            {state.needsApproval ? <ApproverPicker picker={state.picker} action="refund" disabled={state.locked} /> : null}

            <DialogFooter>
              <Button variant="outline" onClick={state.close} disabled={state.submitting}>
                Cancel
              </Button>
              <Button type="submit" variant="destructiveSolid" size="lg" disabled={!state.canSubmit}>
                {state.submitting ? (
                  <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                ) : state.awaiting ? (
                  <RotateCwIcon aria-hidden="true" />
                ) : (
                  <Undo2Icon aria-hidden="true" />
                )}
                {state.submitting
                  ? 'Refunding…'
                  : state.awaiting
                    ? 'Retry'
                    : `${state.needsApproval ? 'Approve and refund' : 'Refund'} ${formatPeso(state.pricing.amount_cents)}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
