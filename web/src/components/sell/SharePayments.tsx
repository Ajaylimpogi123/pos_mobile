/**
 * Equal split at checkout (Dine-in Tables & Tabs T2, §E/§I): one payment step
 * per share. Share `k` is `floor(total / N)` plus 1 centavo for the first
 * `total mod N` shares (`@pos/core/sale/serviceCharge`). Each share is paid in
 * cash (tendered ≥ the share, its own change) or GCash (exactly the share,
 * with its reference). The steps list shows which shares are ready.
 */
import { BanknoteIcon, CircleCheckIcon, SmartphoneIcon } from 'lucide-react';

import { FieldError, FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Input, MoneyInput } from '@/components/ui/input';
import type { CheckoutState } from '@/hooks/sell/useCheckout';
import { cn } from '@/lib/utils';
import { formatPeso } from '@pos/core/money';
import { QUICK_CASH_CENTS } from '@pos/core/sale/payments';

import { Segmented } from './SellParts';

type SplitState = NonNullable<CheckoutState['split']>;

export function SharePayments({ split, locked }: { split: SplitState; locked: boolean }) {
  const index = split.current;
  const share = split.shares[index];
  if (!share) return null;
  const error = split.errors[index] ?? null;
  const last = index === split.shares.length - 1;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2" aria-label="Shares">
        {split.shares.map((entry, at) => {
          const ready = entry.check.payment !== null;
          return (
            <li key={at}>
              <Button
                variant="outline"
                size="sm"
                aria-current={at === index ? 'step' : undefined}
                onClick={() => split.goTo(at)}
                className={cn(
                  at === index && 'border-green-line bg-green-soft',
                  split.errors[at] && 'border-danger-border text-danger',
                )}
              >
                {ready ? <CircleCheckIcon className="text-green" aria-hidden="true" /> : null}
                Share {at + 1}
                <span className="sr-only">{ready ? ', ready' : ', not paid yet'}</span>
              </Button>
            </li>
          );
        })}
      </ol>

      <section aria-label={`Share ${index + 1} of ${split.count}`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-semibold">
            Share {index + 1} of {split.count}
          </h3>
          <span className="text-2xl font-bold text-green tabular">{formatPeso(share.amount)}</span>
        </div>

        <Segmented
          label="Payment method"
          value={share.draft.method}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'gcash', label: 'GCash' },
          ]}
          onChange={(method) => split.setMethod(index, method)}
          disabled={locked}
        />

        {share.draft.method === 'cash' ? (
          <div className="flex flex-col gap-2">
            <FormField label="Cash received">
              <MoneyInput
                autoFocus
                value={share.draft.cash}
                placeholder="0.00"
                onChange={(event) => split.setCash(index, event.target.value)}
                disabled={locked}
                className="h-12 text-lg"
              />
            </FormField>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick cash amounts">
              <Button variant="outline" onClick={() => split.setExact(index)} disabled={locked}>
                <BanknoteIcon aria-hidden="true" />
                Exact
              </Button>
              {QUICK_CASH_CENTS.map((cents) => (
                <Button key={cents} variant="outline" onClick={() => split.setQuickCash(index, cents)} disabled={locked}>
                  {formatPeso(cents).replace('.00', '')}
                </Button>
              ))}
            </div>
            <p className="text-sm">
              Change{' '}
              <span className="text-lg font-bold text-green tabular" aria-live="polite">
                {formatPeso(share.check.summary.changeCents)}
              </span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm">
              <SmartphoneIcon className="size-4" aria-hidden="true" />
              GCash for exactly {formatPeso(share.amount)}
            </p>
            <FormField label="Reference number">
              <Input
                autoFocus
                value={share.draft.reference}
                maxLength={64}
                autoComplete="off"
                onChange={(event) => split.setReference(index, event.target.value)}
                disabled={locked}
              />
            </FormField>
          </div>
        )}

        <FieldError message={error} />

        {!last ? (
          <Button variant="outline" className="w-fit" onClick={split.next} disabled={locked}>
            Next share
          </Button>
        ) : null}
      </section>
    </div>
  );
}
