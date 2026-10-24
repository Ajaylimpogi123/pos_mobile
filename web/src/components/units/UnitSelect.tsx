/**
 * The unit picker (Ingredients, Recipes & Purchasing §L): only the valid units
 * of the item, grouped as *This ingredient's units* and then the standard
 * units of its dimension (`@pos/core/units`). A native `<select>`, so the
 * keyboard and screen readers work as the browser's.
 */
import type { ComponentProps } from 'react';

import { NativeSelect } from '@/components/ui/select';
import type { UnitChoices } from '@pos/core/units';

type UnitSelectProps = Omit<ComponentProps<typeof NativeSelect>, 'children' | 'value' | 'onChange'> & {
  choices: UnitChoices | null;
  value: string;
  onChange: (code: string) => void;
};

export function UnitSelect({ choices, value, onChange, disabled, ...props }: UnitSelectProps) {
  if (!choices) {
    return (
      <NativeSelect value={value} disabled {...props} onChange={() => undefined}>
        <option value={value}>{value === '' ? 'Loading units…' : value}</option>
      </NativeSelect>
    );
  }
  return (
    <NativeSelect value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} {...props}>
      {value !== '' && !choices.own.some((o) => o.code === value) && !choices.catalog.some((o) => o.code === value) ? (
        <option value={value}>{value} (not valid for this item)</option>
      ) : null}
      {choices.own.length > 0 ? (
        <optgroup label="This ingredient's units">
          {choices.own.map((option) => (
            <option key={`own-${option.code}`} value={option.code}>
              {option.code}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Standard units">
        {choices.catalog.map((option) => (
          <option key={`catalog-${option.code}`} value={option.code}>
            {option.code === option.name ? option.code : `${option.code} (${option.name})`}
          </option>
        ))}
      </optgroup>
    </NativeSelect>
  );
}
