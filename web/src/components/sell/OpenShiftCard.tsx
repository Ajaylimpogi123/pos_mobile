/**
 * The Sell screen's shift gate (Shifts & Reporting → Shift gate; Web POS §G
 * W1): **Open shift** with the starting cash (`shift.open`) when this
 * terminal has no open shift, since sales need one. Cash in/out, the X/Z-reads
 * and the close are on the Shifts page (W2), which shows this card too.
 */
import { CirclePlayIcon, ClockIcon, LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MoneyInput } from '@/components/ui/input';
import { useOpenShift } from '@/hooks/useCurrentShift';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { formatPeso, parsePesoInput } from '@pos/core/money';

/** Contract limit of `opening_float_cents`. */
const MAX_OPENING_FLOAT_CENTS = 100_000_000;
const AMOUNT_FORMAT_MESSAGE = 'Enter an amount like 500 or 1,250.50.';

/** The starting cash (₱0.00 is allowed), with the tablet's wording. */
function checkOpeningFloat(text: string): { value: number | null; error: string | null } {
  if (text.trim() === '') return { value: null, error: 'Enter the starting cash (0 if the drawer is empty).' };
  const cents = parsePesoInput(text);
  if (cents === null) return { value: null, error: AMOUNT_FORMAT_MESSAGE };
  if (cents > MAX_OPENING_FLOAT_CENTS) {
    return { value: null, error: `The starting cash can't be more than ${formatPeso(MAX_OPENING_FLOAT_CENTS)}.` };
  }
  return { value: cents, error: null };
}

/** Shown to someone who can sell but not open a shift. */
export const NO_SHIFT_PERMISSION_MESSAGE =
  'Sales need an open shift on this terminal. Ask someone who can open shifts (for example a cashier or a manager) to open one.';

export function OpenShiftCard({ canOpen, notice }: { canOpen: boolean; notice?: string | null }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useOpenShift();
  const fieldError = error ?? (isApiValidationError(mutation.error) ? mutation.error.firstError('opening_float_cents') : null);
  const bannerError =
    mutation.error && !(isApiValidationError(mutation.error) && mutation.error.firstError('opening_float_cents'))
      ? getErrorMessage(mutation.error)
      : null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const checked = checkOpeningFloat(amount);
    setError(checked.error);
    if (checked.value === null) return;
    mutation.mutate(checked.value);
  }

  return (
    <div className="flex justify-center p-4 md:p-8">
      <Card className="flex w-full max-w-lg flex-col gap-4 p-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-green-soft">
          <ClockIcon className="size-6 text-green" aria-hidden="true" />
        </span>
        <h2 className="text-xl font-bold">Open a shift</h2>
        {notice ? <Banner variant="warning">{notice}</Banner> : null}
        {canOpen ? (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={mutation.isPending}>
            <ErrorSummary />
            <p className="text-muted-foreground">
              Count the cash in the drawer and enter it as the starting cash. Sales need an open shift on this terminal.
            </p>
            {bannerError ? <Banner>{bannerError}</Banner> : null}
            <FormField label="Starting cash" error={fieldError}>
              <MoneyInput
                autoFocus
                value={amount}
                placeholder="0.00"
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                }}
                disabled={mutation.isPending}
                className="h-12 text-lg"
              />
            </FormField>
            <Button type="submit" variant="green" size="xl" disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <CirclePlayIcon aria-hidden="true" />}
              {mutation.isPending ? 'Opening…' : 'Open shift'}
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground">{NO_SHIFT_PERMISSION_MESSAGE}</p>
        )}
      </Card>
    </div>
  );
}
