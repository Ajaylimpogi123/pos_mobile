/**
 * The row-actions (⋯) button that ends each data-table row (MASTER §3 Data
 * table): an icon button with an `aria-label` (and a 44 px hit area) opening a
 * menu. Its clicks and keys stop here, so the row itself doesn't open too.
 * Destructive items go last, after a separator, and confirm in a dialog.
 */
import { EllipsisIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
