/**
 * Small Sell pieces: the round − / qty / + stepper (MASTER §3), the discount
 * fields (type, percent or amount, value), and the catalogue image.
 */
import { MinusIcon, PlusIcon, UtensilsIcon } from 'lucide-react';
import { useId } from 'react';

import { FieldError } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Input, MoneyInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Kbd, Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { DISCOUNT_TYPES, type DiscountDraft } from '@pos/core/sale/discountRules';

type QtyStepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
};

export function QtyStepper({ value, onChange, min = 1, max = 999, label, disabled = false, size = 'md' }: QtyStepperProps) {
  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={label}>
      <Button
        variant="outline"
        size={size === 'sm' ? 'icon-sm' : 'icon'}
        className="rounded-full p-0 hover:border-green-line"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        <MinusIcon aria-hidden="true" />
      </Button>
      <span className="min-w-7 text-center font-semibold tabular" aria-live="polite">
        {value}
      </span>
      <Button
        variant="outline"
        size={size === 'sm' ? 'icon-sm' : 'icon'}
        className="rounded-full p-0 hover:border-green-line"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
      >
        <PlusIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

/** A segmented choice (a radio group styled as the MASTER §3 tabs track). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id={labelId}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex w-fit flex-wrap gap-1 rounded-lg bg-track p-1">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-9 rounded-md px-3 text-sm font-medium text-muted-foreground disabled:opacity-60',
                checked ? 'bg-card text-foreground shadow-card' : 'hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const KIND_OPTIONS = [
  { value: 'percent' as const, label: 'Percent (%)' },
  { value: 'amount' as const, label: 'Amount (₱)' },
];

type DiscountFieldsProps = {
  draft: DiscountDraft;
  onChange: (draft: DiscountDraft) => void;
  error: string | null;
  /** Shows an on/off switch (line discounts). */
  toggleLabel?: string;
  disabled?: boolean;
};

/** The fields of a discount (Discount rules): Promo / Employee / Manual, percent or amount, and the value. */
export function DiscountFields({ draft, onChange, error, toggleLabel, disabled = false }: DiscountFieldsProps) {
  const valueId = useId();
  const switchId = useId();
  return (
    <div className="flex flex-col gap-3">
      {toggleLabel ? (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={switchId}>{toggleLabel}</Label>
          <Switch id={switchId} checked={draft.enabled} onCheckedChange={(enabled) => onChange({ ...draft, enabled })} disabled={disabled} />
        </div>
      ) : null}
      {draft.enabled ? (
        <>
          <Segmented label="Type" value={draft.type} options={DISCOUNT_TYPES} onChange={(type) => onChange({ ...draft, type })} disabled={disabled} />
          <Segmented
            label="Discount as"
            value={draft.kind}
            options={KIND_OPTIONS}
            onChange={(kind) => onChange({ ...draft, kind, value: '' })}
            disabled={disabled}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={valueId}>{draft.kind === 'percent' ? 'Percentage' : 'Amount'}</Label>
            {draft.kind === 'percent' ? (
              <Input
                id={valueId}
                inputMode="decimal"
                autoComplete="off"
                value={draft.value}
                placeholder="e.g. 10 or 12.5"
                onChange={(event) => onChange({ ...draft, value: event.target.value })}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${valueId}-error` : undefined}
                className="tabular"
              />
            ) : (
              // back-office.md: money inputs show "₱" as a prefix.
              <MoneyInput
                id={valueId}
                value={draft.value}
                placeholder="0.00"
                onChange={(event) => onChange({ ...draft, value: event.target.value })}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${valueId}-error` : undefined}
              />
            )}
            <FieldError id={`${valueId}-error`} message={error} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A product image from the catalogue. `image_url` is absolute, built from the
 * server's own URL; on the same server (the local `public` disk) the
 * same-origin `/storage/…` path is used, so it loads through the dev proxy
 * and under the CSP (`img-src 'self'`).
 * An image on another origin (a future S3-compatible disk, Q-038) is loaded as is;
 * its origin must be set in `VITE_IMAGE_ORIGIN` so the build adds it to the CSP `img-src`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function catalogImageSrc(imageUrl: string | null, imagePath: string | null): string | null {
  if (!imageUrl) return null;
  try {
    const url = new URL(imageUrl, window.location.origin);
    if (url.pathname.startsWith('/storage/')) return url.pathname;
    return url.origin === window.location.origin ? url.pathname : imageUrl;
  } catch {
    return imagePath ? `/storage/${imagePath}` : null;
  }
}

export function ProductImage({
  imageUrl,
  imagePath,
  className,
}: {
  imageUrl: string | null;
  imagePath: string | null;
  className?: string;
}) {
  const src = catalogImageSrc(imageUrl, imagePath);
  if (!src) {
    return (
      <div className={cn('flex items-center justify-center rounded-lg bg-tile text-muted-foreground', className)} aria-hidden="true">
        <UtensilsIcon className="size-1/3 max-h-10 max-w-10" />
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" className={cn('rounded-lg bg-tile object-cover', className)} />;
}

/** The Sell shortcuts as `kbd` hints (MASTER §4, sell.md → Keyboard). */
export function KeyboardHints({ className }: { className?: string }) {
  const hints: { keys: string[]; label: string; aria: string }[] = [
    { keys: ['↑', '↓', '←', '→'], label: 'move', aria: 'Arrow keys' },
    { keys: ['Enter'], label: 'add', aria: 'Enter' },
    { keys: ['F2'], label: 'pay', aria: 'F2' },
    { keys: ['Esc'], label: 'close', aria: 'Escape' },
  ];
  return (
    <ul aria-label="Keyboard shortcuts" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground', className)}>
      {hints.map((hint) => (
        <li key={hint.label} className="flex items-center gap-1.5">
          <span className="sr-only">{hint.aria}:</span>
          <span aria-hidden="true" className="flex items-center gap-0.5">
            {hint.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
          {hint.label}
        </li>
      ))}
    </ul>
  );
}
