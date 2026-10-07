import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { probePrinters } from '@/printing/printActions';
import type { Printer } from '@/services/types';

/**
 * Probes these printers when the screen gains focus (docs/api-contract.md →
 * Printing → Screens): a 3 s connect, at most once a minute per printer,
 * skipping busy lanes. Results land in the printing store.
 */
export function usePrinterReachability(printers: readonly Printer[]): void {
  useFocusEffect(
    useCallback(() => {
      if (printers.length > 0) void probePrinters(printers);
    }, [printers]),
  );
}
