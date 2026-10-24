/** This terminal's receipt printer (Web POS §F: chosen per terminal, kept in localStorage). */
import { ChevronDownIcon, PrinterIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReceiptPrinterChoice } from '@/hooks/usePrintConfig';

export function ReceiptPrinterPicker({ choice, compact = false }: { choice: ReceiptPrinterChoice; compact?: boolean }) {
  const { options, current, choose } = choice;
  if (options.length === 0) {
    return <span className="text-[13px] text-muted-foreground">No receipt printer set up</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={compact ? 'sm' : 'default'} aria-label={`Receipt printer: ${current?.name ?? 'none'}. Change`}>
          <PrinterIcon aria-hidden="true" />
          <span className="max-w-40 truncate">{current?.name ?? 'Choose printer'}</span>
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Receipts from this terminal</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current ? String(current.id) : ''} onValueChange={(value) => choose(Number(value))}>
          {options.map((printer) => (
            <DropdownMenuRadioItem key={printer.id} value={String(printer.id)}>
              {printer.name}
              <span className="ml-auto text-xs text-muted-foreground">
                {printer.host}:{printer.port}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
