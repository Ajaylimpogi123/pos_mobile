import { StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/shared/FormSection';
import { PrintJobRows } from '@/components/printing/PrintJobRows';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/constants/theme';
import { usePrintJobs } from '@/hooks/printing/usePrintJobs';
import { NO_RECEIPT_PRINTER_MESSAGE, printReceipt } from '@/printing/printActions';
import type { PrintableOrder } from '@/services/types';
import { usePrintingStore } from '@/stores/printing';

type SalePrintStatusProps = {
  order: PrintableOrder;
};

const NO_JOBS: readonly string[] = [];

/**
 * Below "Sale complete" (docs/api-contract.md → Printing → Screens): one row
 * per print job ("Sending…", "Sent", or failed with Retry), the items not
 * sent to any printer, "Print receipt" when auto-print is off, and the
 * notices (no receipt printer; Expo Go can't print). The sale is already
 * complete: nothing here can block or undo it.
 */
export function SalePrintStatus({ order }: SalePrintStatusProps) {
  const summary = usePrintingStore((state) => state.sales[order.ulid]);
  const jobs = usePrintJobs(summary?.jobIds ?? NO_JOBS);

  if (!summary) return null;

  return (
    <View style={styles.section} testID="sale-printing">
      <SectionLabel>Printing</SectionLabel>
      {summary.notice ? <Banner variant="info" message={summary.notice} testID="sale-printing-notice" /> : null}
      {summary.preparing ? <Text style={styles.muted}>Preparing the receipt and tickets…</Text> : null}
      {summary.noReceiptPrinter ? (
        <Banner variant="warning" message={NO_RECEIPT_PRINTER_MESSAGE} testID="sale-no-receipt-printer" />
      ) : null}
      {summary.manualReceipt ? (
        <Button
          title="Print receipt"
          leftIcon="print-outline"
          variant="secondary"
          onPress={() => void printReceipt(order)}
          testID="sale-print-receipt"
        />
      ) : null}
      <PrintJobRows jobs={jobs} testID="sale-print-job" />
      {summary.unrouted.length > 0 ? (
        <View style={styles.unrouted} testID="sale-unrouted">
          <Banner variant="warning" message="Not sent to any printer. Tell the kitchen or bar:" />
          {summary.unrouted.map((line, index) => (
            <Text key={`${line}-${index}`} style={styles.unroutedLine}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  unrouted: {
    gap: spacing.xs,
  },
  unroutedLine: {
    ...typography.bodySm,
    color: colors.text,
  },
});
