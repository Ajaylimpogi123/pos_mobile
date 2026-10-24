/** Input and Textarea (ported from the legacy `Components/ui/input.jsx`). 8 px radius, white, 1 px border. */
import * as React from 'react';

import { cn } from '@/lib/utils';

const fieldClasses =
  'w-full min-w-0 rounded-lg border border-input bg-card px-3 text-[15px] text-foreground shadow-card placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(fieldClasses, 'h-10 py-1', className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldClasses, 'min-h-20 py-2', className)} {...props} />;
}

/** A money field with the "₱" prefix (back-office.md: money inputs show ₱ as a prefix). */
function MoneyInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
        ₱
      </span>
      <Input type="text" inputMode="decimal" autoComplete="off" className={cn('pl-7 tabular', className)} {...props} />
    </div>
  );
}

export { Input, MoneyInput, Textarea };
