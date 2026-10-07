import { PrinterFormScreen } from '@/components/printers/PrinterFormScreen';

/** New printer: POST /api/v1/admin/printers (`settings.manage`). */
export default function NewPrinterRoute() {
  return <PrinterFormScreen />;
}
