import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { spacing } from '@/constants/theme';
import { NO_DEFAULT_KITCHEN_MESSAGE, type PrinterListScreenState } from '@/hooks/printers/usePrinterListScreen';

/** Whether `PrinterNotices` has anything to show (a list header is only added when it does). */
export function hasPrinterNotices(screen: PrinterListScreenState): boolean {
  return Boolean(screen.printingUnavailable || screen.staleMessage || screen.offline || screen.noDefaultKitchen);
}

/**
 * The Printers list notices: printing unavailable in this build, the cached
 * list shown after a failed sync or offline, and no default kitchen printer.
 * Nothing when all is well.
 */
export function PrinterNotices({ screen }: { screen: PrinterListScreenState }) {
  const notices = [];
  if (screen.printingUnavailable) {
    notices.push(<Banner key="unavailable" variant="info" message={screen.printingUnavailable} testID="printers-unavailable" />);
  }
  if (screen.staleMessage) {
    notices.push(
      <Banner key="stale" variant="warning" message={`Showing the printers saved on this tablet. ${screen.staleMessage}`} testID="printers-stale" />,
    );
  } else if (screen.offline) {
    notices.push(<Banner key="offline" variant="info" message="Offline: showing the printers saved on this tablet." testID="printers-offline" />);
  }
  if (screen.noDefaultKitchen) {
    notices.push(<Banner key="no-default" variant="warning" message={NO_DEFAULT_KITCHEN_MESSAGE} testID="printers-no-default" />);
  }

  if (notices.length === 0) return null;
  return <View style={styles.notices}>{notices}</View>;
}

const styles = StyleSheet.create({
  notices: {
    gap: spacing.sm,
  },
});
