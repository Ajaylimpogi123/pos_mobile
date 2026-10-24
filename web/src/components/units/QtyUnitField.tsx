/**
 * A quantity with its unit (§A, §L): the quantity input, the unit picker, and
 * the live base preview (`= 50,000 g (50 kg)`), computed exactly with `BigInt`
 * (`toBaseQty`). Each part shows its own message underneath.
 */
import { useId } from 'react';

import { FieldError } from '@/components/common/FormField';
import { UnitSelect } from '@/components/units/UnitSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBaseQty, parseQtyInput, toBaseQty } from '@pos/core/quantity';
import { findUnit, type UnitChoices } from '@pos/core/units';

type QtyUnitFieldProps = {
  label: string;
  qty: string;
  unit: string;
  choices: UnitChoices | null;
  onQty: (text: string) => void;
  onUnit: (code: string) => void;
  qtyError?: string | null;
  unitError?: string | null;
  disabled?: boolean;
  placeholder?: string;
  /** Shows `= 25,000 g` under the field (default on). */
  showBase?: boolean;
  allowZero?: boolean;
};

/** `= 50,000 g (50 kg)` for a readable quantity and unit, else `null`. */
function basePreview(qty: string, unit: string, choices: UnitChoices | null, allowZero = false): string | null {
  if (!choices) return null;
  const parsed = parseQtyInput(qty, { allowZero });
  const option = findUnit(choices, unit);
  if (!parsed.ok || !option || option.code === choices.baseUnit) return null;
  const base = toBaseQty(parsed.value, option.factor);
  return base === null ? null : `= ${formatBaseQty(base, choices.baseUnit)}`;
}

export function QtyUnitField({
  label,
  qty,
  unit,
  choices,
  onQty,
  onUnit,
  qtyError,
  unitError,
  disabled = false,
  placeholder = '0',
  showBase = true,
  allowZero = false,
}: QtyUnitFieldProps) {
  const id = useId();
  const qtyId = `${id}-qty`;
  const unitId = `${id}-unit`;
  const preview = showBase ? basePreview(qty, unit, choices, allowZero) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={qtyId}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={qtyId}
          inputMode="decimal"
          autoComplete="off"
          value={qty}
          onChange={(event) => onQty(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="tabular"
          aria-invalid={qtyError ? true : undefined}
          aria-describedby={[qtyError ? `${qtyId}-error` : null, preview ? `${qtyId}-base` : null].filter(Boolean).join(' ') || undefined}
        />
        <label htmlFor={unitId} className="sr-only">
          Unit
        </label>
        <UnitSelect
          id={unitId}
          className="w-40 shrink-0"
          choices={choices}
          value={unit}
          onChange={onUnit}
          disabled={disabled}
          aria-invalid={unitError ? true : undefined}
          aria-describedby={unitError ? `${unitId}-error` : undefined}
        />
      </div>
      {preview ? (
        <p id={`${qtyId}-base`} className="text-[13px] text-muted-foreground tabular">
          {preview}
        </p>
      ) : null}
      <FieldError id={`${qtyId}-error`} message={qtyError} />
      <FieldError id={`${unitId}-error`} message={unitError} />
    </div>
  );
}
