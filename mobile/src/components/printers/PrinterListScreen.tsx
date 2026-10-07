import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrinterCard } from '@/components/printers/PrinterCard';
import { hasPrinterNotices, PrinterNotices } from '@/components/printers/PrinterNotices';
import { CardGrid } from '@/components/shared/CardGrid';
import { ListHeader } from '@/components/shared/ListHeader';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { Screen } from '@/components/ui/Screen';
import { printerRoute, ROUTES } from '@/constants/routes';
import { usePrinterListScreen } from '@/hooks/printers/usePrinterListScreen';
import type { Printer } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

export function openNewPrinter() {
  router.push(ROUTES.newPrinter);
}

export function editPrinter(printer: Printer) {
  router.push(printerRoute(printer.id));
}

function printerKey(printer: { id: number }): string {
  return String(printer.id);
}

/**
 * Printers (`sale.create` or `settings.manage`; docs/api-contract.md →
 * Printing → Screens). The list comes from the print config cached on this
 * tablet, so it works offline. Each card has a reachability pill, Test
 * print and, for receipt printers, "Receipts from this tablet". With
 * `settings.manage`: "+" to add a printer and Edit on each card.
 * Card grid: 1 / 2 / 3 columns by size, pull-to-refresh (sync + probe),
 * loading / empty / error-with-Retry. The cards are memoized and get stable
 * handlers, so a test print only re-renders its own card.
 */
export function PrinterListScreen() {
  const screen = usePrinterListScreen();
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.settingsManage));
  const testPrint = useLatestCallback(screen.testPrint);
  const chooseForReceipts = useLatestCallback(screen.useForReceipts);

  return (
    <Screen edges={[]} testID="printer-list-screen">
      <ListHeader
        title="Printers"
        newLabel="New printer"
        onNew={canManage ? openNewPrinter : undefined}
        testIDPrefix="printers"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <CardGrid
          items={screen.printers}
          keyOf={printerKey}
          renderItem={(printer) => (
            <PrinterCard
              printer={printer}
              reachability={screen.reachability[printer.id]}
              isTabletReceiptPrinter={screen.receiptPrinterId === printer.id}
              test={screen.tests[printer.id]}
              canPrint={screen.printingUnavailable === null}
              onTestPrint={testPrint}
              onUseForReceipts={chooseForReceipts}
              onEdit={canManage ? editPrinter : undefined}
            />
          )}
          loading={screen.loading}
          error={screen.error}
          onRetry={screen.retry}
          onRefresh={screen.refresh}
          hasNextPage={false}
          isFetchingNextPage={false}
          nextPageError={null}
          fetchNextPage={() => undefined}
          header={hasPrinterNotices(screen) ? <PrinterNotices screen={screen} /> : undefined}
          empty={
            canManage
              ? {
                  title: 'No printers yet',
                  message: 'Add the receipt printer at the counter and the kitchen and bar printers, with their IP addresses.',
                  icon: 'print-outline',
                  actionLabel: 'New printer',
                  onAction: openNewPrinter,
                }
              : {
                  title: 'No printers yet',
                  message: 'A manager adds the branch’s printers in Printers. They show here after the next sync.',
                  icon: 'print-outline',
                }
          }
          testID="printers-grid"
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});
