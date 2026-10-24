/**
 * Checkout (`F2`; Core Sale → App → Checkout, Approval, Submitting): the
 * server-algorithm totals on the left; cash (Exact, ₱100, ₱500, ₱1,000), GCash
 * with its reference, split tender and the live amount due or change on the
 * right. A discount above the cashier's limit asks for a manager: pick an
 * approver, then their PIN, and the same sale (same ULID) is sent again.
 * Dine-in settlement (v1.26 §I): the service charge row and its toggle, and
 * for an equal split one payment step per share (`SharePayments`).
 */
import { ArrowLeftIcon, BanknoteIcon, LoaderCircleIcon, PlusIcon, SmartphoneIcon, XIcon } from 'lucide-react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, MoneyInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { serviceChargeLabel } from '@pos/core/printing/documents/receipt';

import { SharePayments } from './SharePayments';
import { SHOW_VAT_BREAKDOWN } from '@pos/core/features';
import type { CheckoutState } from '@/hooks/sell/useCheckout';
import { isPinComplete } from '@/hooks/sell/useCheckout';
import { cn } from '@/lib/utils';
import { formatPercentValue } from '@pos/core/sale/discountRules';
import { QUICK_CASH_CENTS } from '@pos/core/sale/payments';
import { VAT_RATE_BPS } from '@pos/core/sale/pricing';
import { SC_PWD_DISCOUNT_LABEL } from '@pos/core/sale/scPwd';
import { formatPeso, parsePesoInput } from '@pos/core/money';

type CheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkout: CheckoutState;
};

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'muted' }) {
  return (
    <div className={cn('flex justify-between gap-3', tone === 'danger' && 'text-danger', tone === 'muted' && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className="font-semibold tabular">{value}</span>
    </div>
  );
}

export function CheckoutDialog({ open, onOpenChange, checkout }: CheckoutDialogProps) {
  const { cart, summary, draft, tenderErrors, banner, locked, approval } = checkout;
  const { pricing } = cart;
  const typedCash = draft.cash.trim() === '' ? null : parsePesoInput(draft.cash);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A sale in flight can't be closed over (its answer is still coming).
        if (!next && checkout.submitting) return;
        if (!next) checkout.cancelApproval();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-4xl" hideClose={checkout.submitting}>
        <DialogHeader>
          <DialogTitle>{approval.visible ? 'Manager approval' : 'Checkout'}</DialogTitle>
          <DialogDescription>
            {approval.visible
              ? (approval.reason ?? 'This discount is above your limit. A manager approves it with their PIN.')
              : `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}${cart.customer ? ` · ${cart.customer.full_name}` : ''}${
                  cart.tableNo.trim() ? ` · Table ${cart.tableNo.trim()}` : ''
                }`}
          </DialogDescription>
        </DialogHeader>

        {approval.visible ? (
          <ApprovalPanel checkout={checkout} />
        ) : (
          <form
            className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
            onSubmit={(event) => {
              event.preventDefault();
              if (checkout.canConfirm) checkout.confirm();
            }}
            aria-busy={checkout.submitting}
          >
            <ErrorSummary className="md:col-span-2" />
            <section aria-label="Sale summary" className="flex flex-col gap-2 rounded-xl bg-subtle p-4 text-[15px]">
              <SummaryRow label="Subtotal" value={formatPeso(pricing.subtotal_cents)} />
              {pricing.line_discounts_cents + pricing.order_discount_cents > 0 ? (
                <SummaryRow label="Discounts" value={`-${formatPeso(pricing.line_discounts_cents + pricing.order_discount_cents)}`} tone="danger" />
              ) : null}
              {cart.scPwd?.vat_exempt ? (
                <SummaryRow label="VAT exempted" value={`-${formatPeso(pricing.sc_pwd_vat_relief_cents)}`} tone="danger" />
              ) : null}
              {cart.scPwd ? <SummaryRow label={SC_PWD_DISCOUNT_LABEL} value={`-${formatPeso(pricing.sc_pwd_discount_cents)}`} tone="danger" /> : null}
              {cart.serviceCharge && cart.serviceCharge.bps > 0 ? (
                <div className="flex flex-col gap-1">
                  <SummaryRow label={serviceChargeLabel(cart.serviceCharge.bps)} value={formatPeso(cart.serviceChargeCents)} />
                  <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                    <Label htmlFor="checkout-service-charge" className="text-[13px] font-normal">
                      Add service charge
                    </Label>
                    <Switch
                      id="checkout-service-charge"
                      checked={cart.serviceCharge.on}
                      onCheckedChange={checkout.setServiceChargeOn}
                      disabled={locked}
                    />
                  </div>
                </div>
              ) : null}
              {SHOW_VAT_BREAKDOWN ? (
                <>
                  <SummaryRow label="VATable sales" value={formatPeso(pricing.vatable_sales_cents)} tone="muted" />
                  <SummaryRow label={`VAT ${formatPercentValue(VAT_RATE_BPS)}`} value={formatPeso(pricing.vat_amount_cents)} tone="muted" />
                  <SummaryRow label="VAT-exempt sales" value={formatPeso(pricing.vat_exempt_sales_cents)} tone="muted" />
                </>
              ) : null}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                <span className="text-lg font-bold">Total</span>
                <span className="text-[32px] leading-none font-bold text-green tabular">{formatPeso(pricing.total_cents)}</span>
              </div>
              {checkout.split ? null : (
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-3">
                <div>
                  <p className="text-[13px] text-muted-foreground">{summary.short ? 'Amount due' : 'Paid'}</p>
                  <p className={cn('text-xl font-bold tabular', summary.short ? 'text-danger' : 'text-foreground')} aria-live="polite">
                    {formatPeso(summary.short ? summary.dueCents : summary.paidCents)}
                  </p>
                </div>
                <div>
                  <p className="text-[13px] text-muted-foreground">Change</p>
                  <p className="text-xl font-bold text-green tabular" aria-live="polite">
                    {formatPeso(summary.changeCents)}
                  </p>
                </div>
              </div>
              )}
            </section>

            <section aria-label="Payments" className="flex flex-col gap-4">
              {checkout.shiftBlock ? <Banner variant="warning">{checkout.shiftBlock}</Banner> : null}
              {banner ? (
                <Banner
                  variant={banner.variant}
                  actions={
                    banner.retry === 'lookup' ? (
                      <Button variant="outline" size="sm" onClick={checkout.retryLookup} disabled={checkout.submitting}>
                        Retry
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={checkout.dismissBanner}>
                        Dismiss
                      </Button>
                    )
                  }
                >
                  {banner.message}
                </Banner>
              ) : null}

              {checkout.split ? (
                <>
                  <SharePayments split={checkout.split} locked={locked} />
                  {/* A server 422 on `payments` (e.g. "This GCash payment must be exactly ₱94.23."). */}
                  <FieldError message={tenderErrors?.general} />
                </>
              ) : (
              <>
              <div className="flex flex-col gap-2">
                <FormField label="Cash received" error={tenderErrors?.cash}>
                  <MoneyInput
                    autoFocus
                    value={draft.cash}
                    placeholder="0.00"
                    onChange={(event) => checkout.setCash(event.target.value)}
                    disabled={locked}
                    className="h-12 text-lg"
                  />
                </FormField>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Quick cash amounts">
                  <Button variant="outline" onClick={checkout.setExactCash} disabled={locked}>
                    <BanknoteIcon aria-hidden="true" />
                    Exact
                  </Button>
                  {QUICK_CASH_CENTS.map((cents) => (
                    <Button
                      key={cents}
                      variant="outline"
                      onClick={() => checkout.setQuickCash(cents)}
                      disabled={locked}
                      aria-pressed={typedCash === cents}
                      className={cn(typedCash === cents && 'border-green-line bg-green-soft')}
                    >
                      {formatPeso(cents).replace('.00', '')}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {draft.gcash.map((row, index) => {
                  const rowErrors = tenderErrors?.gcash[row.key];
                  return (
                    <div key={row.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <SmartphoneIcon className="size-4" aria-hidden="true" />
                          GCash {draft.gcash.length > 1 ? index + 1 : ''}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => checkout.removeGcash(row.key)}
                          disabled={locked}
                          aria-label={`Remove GCash payment ${index + 1}`}
                        >
                          <XIcon aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <FormField label="Amount" error={rowErrors?.amount}>
                          <MoneyInput value={row.amount} onChange={(event) => checkout.updateGcash(row.key, { amount: event.target.value })} disabled={locked} />
                        </FormField>
                        <FormField label="Reference number" error={rowErrors?.reference}>
                          <Input
                            value={row.reference}
                            maxLength={64}
                            autoComplete="off"
                            onChange={(event) => checkout.updateGcash(row.key, { reference: event.target.value })}
                            disabled={locked}
                          />
                        </FormField>
                      </div>
                    </div>
                  );
                })}
                {checkout.canAddGcash ? (
                  <Button variant="outline" className="w-fit" onClick={checkout.addGcash}>
                    <PlusIcon aria-hidden="true" />
                    Add GCash payment
                  </Button>
                ) : null}
              </div>

              <FieldError message={tenderErrors?.general} />
              {summary.gcashOverTotal && !tenderErrors?.general ? <FieldError message="GCash can't be more than the total." /> : null}
              </>
              )}

              <Button type="submit" variant="green" size="xl" className="w-full" disabled={!checkout.canConfirm}>
                {checkout.submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
                {checkout.submitting
                  ? 'Sending…'
                  : cart.awaitingConfirmation
                    ? 'Retry'
                    : checkout.repricing
                      ? 'Updating prices…'
                      : `Charge ${formatPeso(pricing.total_cents)}`}
              </Button>
            </section>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApprovalPanel({ checkout }: { checkout: CheckoutState }) {
  const { approval } = checkout;

  if (approval.step === 'pin' && approval.approver) {
    return (
      <form
        className="mx-auto flex w-full max-w-sm flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          checkout.approve();
        }}
      >
        <ErrorSummary />
        <Button variant="ghost" className="w-fit" onClick={checkout.backToApprovers} disabled={checkout.submitting}>
          <ArrowLeftIcon aria-hidden="true" />
          Choose someone else
        </Button>
        <p className="font-semibold">{approval.approver.name}</p>
        <FormField label="PIN" error={approval.error}>
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={approval.pin}
            onChange={(event) => checkout.setApprovalPin(event.target.value)}
            disabled={checkout.submitting}
            className="h-12 text-center text-2xl tracking-[0.5em]"
          />
        </FormField>
        <Button type="submit" variant="green" size="xl" disabled={!isPinComplete(approval.pin) || checkout.submitting}>
          {checkout.submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {checkout.submitting ? 'Approving…' : 'Approve and charge'}
        </Button>
        <Button variant="outline" onClick={checkout.cancelApproval} disabled={checkout.submitting}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {approval.error ? <Banner>{approval.error}</Banner> : null}
      <p className="text-sm font-medium">Who approves this discount?</p>
      {checkout.approversLoading ? (
        <LoadingRows rows={3} />
      ) : checkout.approversError ? (
        <ErrorState message={checkout.approversError} onRetry={checkout.retryApprovers} />
      ) : checkout.approvers.length === 0 ? (
        <Banner variant="warning">Nobody on this branch with a PIN can approve a discount this large. Lower the discount.</Banner>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {checkout.approvers.map((person) => (
            <li key={person.id}>
              <Button variant="outline" className="h-auto w-full justify-start py-3" onClick={() => checkout.chooseApprover(person)}>
                <span className="flex flex-col items-start">
                  <span className="font-semibold">{person.name}</span>
                  <span className="text-[13px] text-muted-foreground">{person.role.name}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" className="w-fit" onClick={checkout.cancelApproval}>
        Cancel
      </Button>
    </div>
  );
}
