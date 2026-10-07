import { useMemo } from 'react';

import { Chip, type ChipVariant } from '@/components/ui/Chip';
import type { IconName } from '@/components/ui/Icon';
import { usePrinterReachability } from '@/hooks/printing/usePrinterReachability';
import { sellPrinters } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import type { Printer } from '@/services/types';
import { usePrintingStore, type Reachability } from '@/stores/printing';

type PillLook = { label: string; variant: ChipVariant; icon: IconName };

export type PrinterStatusInput = {
  /** Printing can run in this build. */
  available: boolean;
  /** The print config is on this tablet. */
  configured: boolean;
  /** This tablet's receipt printer and the enabled kitchen and bar printers. */
  printers: readonly Printer[];
  reachability: Record<number, Reachability>;
};

/** The label, colour and glyph of the Sell header's printer pill. */
export function describePrinterStatus(input: PrinterStatusInput): PillLook {
  if (!input.available) return { label: 'Printing unavailable', variant: 'caution', icon: 'print-outline' };
  if (!input.configured) return { label: 'Printers not synced', variant: 'neutral', icon: 'print-outline' };
  if (input.printers.length === 0) return { label: 'No printers', variant: 'neutral', icon: 'print-outline' };

  const down = input.printers.filter((printer) => input.reachability[printer.id]?.state === 'down');
  if (down.length === 1) return { label: `${down[0].name} not responding`, variant: 'cancelled', icon: 'alert-circle-outline' };
  if (down.length > 1) return { label: `${down.length} printers not responding`, variant: 'cancelled', icon: 'alert-circle-outline' };

  const allOk = input.printers.every((printer) => input.reachability[printer.id]?.state === 'ok');
  if (allOk) return { label: 'Printers ready', variant: 'completed', icon: 'print' };
  return { label: 'Checking printers…', variant: 'neutral', icon: 'print-outline' };
}

/**
 * Printer status chip in the Sell top bar, next to the sync chip (icon-only on
 * phones in portrait): a
 * reachability probe of this tablet's receipt printer and the enabled kitchen
 * and bar printers when Sell gains focus (3 s, at most once a minute, busy
 * lanes skipped).
 */
export function PrinterStatusPill({ iconOnly = false }: { iconOnly?: boolean }) {
  const config = usePrintingStore((state) => state.config);
  const receiptPrinterId = usePrintingStore((state) => state.receiptPrinterId);
  const reachability = usePrintingStore((state) => state.reachability);
  const printers = useMemo(() => sellPrinters(config, receiptPrinterId), [config, receiptPrinterId]);
  usePrinterReachability(printers);

  const look = describePrinterStatus({
    available: getPrintTransport().available,
    configured: config !== null,
    printers,
    reachability,
  });
  return <Chip label={look.label} variant={look.variant} icon={look.icon} size="bar" iconOnly={iconOnly} testID="printer-status" />;
}
