/**
 * A native `<select>` styled like `Input` (8 px radius, white, 1 px border):
 * keyboard and screen-reader behaviour come from the browser.
 */
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        data-slot="select"
        className="h-10 w-full min-w-0 appearance-none rounded-lg border border-input bg-card py-1 pr-9 pl-3 text-[15px] text-foreground shadow-card disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-3 right-3 size-4 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

export { NativeSelect };
