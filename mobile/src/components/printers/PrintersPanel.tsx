import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { PrinterCard } from '@/components/printers/PrinterCard';
import { editPrinter, openNewPrinter } from '@/components/printers/PrinterListScreen';
import { PrinterNotices } from '@/components/printers/PrinterNotices';
import { PaneHeader } from '@/components/shared/PaneHeader';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, spacing } from '@/constants/theme';
import { usePrinterListScreen } from '@/hooks/printers/usePrinterListScreen';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { Printer } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

function printerKey(printer: Printer): string {
  return String(printer.id);
}

/**
 * The Printers section of Settings on tablets (the right-hand pane, as in
 * the Settings mock): a heading with **Add printer**, the notices, then one
 * column of printer cards (virtualized) with Test print, "Receipts from this
 * tablet" and Edit. The same data and actions as the Printers screen
 * (`usePrinterListScreen`: the cached print config, so it works offline),
 * with loading, error with Retry, empty and pull-to-refresh (sync + probe).
 */
export function PrintersPanel() {
  const screen = usePrinterListScreen();
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.settingsManage));
  const { isLandscape, gutter, screenPaddingY } = useResponsive();
  const [refreshing, setRefreshing] = useState(false);
  const testPrint = useLatestCallback(screen.testPrint);
  const chooseForReceipts = useLatestCallback(screen.useForReceipts);

  async function refresh() {
    setRefreshing(true);
    try {
      await screen.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      colors={[colors.primaryBright]}
      tintColor={colors.primaryBright}
    />
  );

  let body;
  if (screen.loading) {
    body = <LoadingState variant="list" message="Loading printers…" testID="printers-panel-loading" />;
  } else if (screen.printers.length === 0 && screen.error) {
    body = (
      <ErrorState
        title="Couldn't load the printers"
        message={getErrorMessage(screen.error)}
        onRetry={screen.retry}
        refreshControl={refreshControl}
        testID="printers-panel-error"
      />
    );
  } else if (screen.printers.length === 0) {
    body = (
      <EmptyState
        title="No printers yet"
        message="Add the receipt printer at the counter and the kitchen and bar printers, with their IP addresses."
        icon="print-outline"
        actionLabel={canManage ? 'Add printer' : undefined}
        onAction={canManage ? openNewPrinter : undefined}
        refreshControl={refreshControl}
        testID="printers-panel-empty"
      />
    );
  } else {
    body = (
      <FlatList
        data={screen.printers}
        keyExtractor={printerKey}
        renderItem={({ item }) => (
          <PrinterCard
            printer={item}
            reachability={screen.reachability[item.id]}
            isTabletReceiptPrinter={screen.receiptPrinterId === item.id}
            test={screen.tests[item.id]}
            canPrint={screen.printingUnavailable === null}
            onTestPrint={testPrint}
            onUseForReceipts={chooseForReceipts}
            onEdit={canManage ? editPrinter : undefined}
            wide={isLandscape}
          />
        )}
        contentContainerStyle={{ gap: gutter, paddingBottom: screenPaddingY }}
        refreshControl={refreshControl}
        testID="printers-panel-list"
      />
    );
  }

  return (
    <View style={styles.container} testID="printers-panel">
      <View style={[styles.top, { gap: gutter, paddingBottom: gutter }]}>
        <PaneHeader
          title="Printers"
          description="Receipts print at the counter; kitchen and bar tickets follow each category’s printer."
          action={
            canManage ? <Button title="Add printer" leftIcon="add" onPress={openNewPrinter} testID="printers-panel-new" /> : null
          }
        />
        <PrinterNotices screen={screen} />
      </View>
      <View style={styles.body}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  top: {
    paddingTop: spacing.xxs,
  },
  body: {
    flex: 1,
  },
});
