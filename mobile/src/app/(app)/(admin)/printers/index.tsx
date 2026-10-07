import { PrinterListScreen } from '@/components/printers/PrinterListScreen';

/** Printers: the branch's printers from the cached GET /api/v1/print-config (works offline). */
export default function PrintersIndexRoute() {
  return <PrinterListScreen />;
}
