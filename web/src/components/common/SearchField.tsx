/**
 * The list search box: a visible label with its `/` hint, a search icon and
 * `type="search"` (Esc clears it in the browser). It filters as you type
 * (the caller debounces), and `/` focuses it from anywhere on the page
 * (MASTER §6 Search).
 */
import { SearchIcon } from 'lucide-react';
import { useRef } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Kbd } from '@/components/ui/misc';
import { useSlashFocus } from '@/hooks/useSlashFocus';
import { cn } from '@/lib/utils';

type SearchFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  /** `/` focuses this field (default on; turn off for a second search on the same page). */
  slashFocus?: boolean;
};

export function SearchField({ id, label, value, onChange, placeholder, maxLength = 100, className, slashFocus = true }: SearchFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  useSlashFocus(ref, slashFocus);
  return (
    <div className={cn('flex min-w-[220px] flex-1 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {slashFocus ? <Kbd aria-hidden="true">/</Kbd> : null}
      </Label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={ref}
          id={id}
          type="search"
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="pl-9"
          autoComplete="off"
          aria-keyshortcuts={slashFocus ? '/' : undefined}
        />
      </div>
    </div>
  );
}
