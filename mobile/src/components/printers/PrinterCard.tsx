import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StatusDot, type PrinterDotState } from '@/components/printing/StatusDot';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { colors, iconSizes, radius, sizes, spacing, typography } from '@/constants/theme';
import type { TestPrintState } from '@/hooks/printers/usePrinterListScreen';
import { printerRoleLabel } from '@/printing/documents/format';
import { columnsFor } from '@/printing/escpos/layout';
import type { Printer, PrinterRole } from '@/services/types';
import type { Reachability } from '@/stores/printing';

type PrinterCardProps = {
  printer: Printer;
  reachability: Reachability | undefined;
  /** This tablet sends its receipts here. */
  isTabletReceiptPrinter: boolean;
  test: TestPrintState | undefined;
  /** `false` in Expo Go and other builds that can't print. */
  canPrint: boolean;
  /** Stable handlers (they receive the printer), so the memoized card only re-renders when its data changes. */
  onTestPrint: (printer: Printer) => void;
  onUseForReceipts: (printer: Printer) => void;
  /** `settings.manage`: the round Edit button. */
  onEdit?: (printer: Printer) => void;
  /** A wide single-column list (the Settings pane): Test print sits at the right of the header row. */
  wide?: boolean;
};

const ROLE_ICONS: Record<PrinterRole, IconName> = {
  cashier: 'receipt-outline',
  kitchen: 'restaurant-outline',
  bar: 'wine-outline',
};

function dotState(printer: Printer, reachability: Reachability | undefined): PrinterDotState {
  if (!printer.is_enabled) return 'off';
  return reachability?.state ?? 'unknown';
}

function routesLabel(printer: Printer): string | null {
  if (printer.role === 'cashier') return null;
  const count = printer.category_ids.length;
  if (count === 0) return printer.is_default_kitchen ? 'Items with no route' : 'No categories';
  return `${count} ${count === 1 ? 'category' : 'categories'}`;
}

/**
 * One printer (Settings mock): a soft icon tile, the name with its
 * reachability pill, the address and paper line, tags (role, turned off,
 * default kitchen printer, routes), **Test print**, and for receipt printers
 * "Receipts from this tablet".
 */
export const PrinterCard = memo(function PrinterCard({
  printer,
  reachability,
  isTabletReceiptPrinter,
  test,
  canPrint,
  onTestPrint,
  onUseForReceipts,
  onEdit,
  wide = false,
}: PrinterCardProps) {
  const testID = `printer-card-${printer.id}`;
  const routes = routesLabel(printer);

  const testButton = (
    <Button
      title="Test print"
      leftIcon="print-outline"
      variant="secondary"
      onPress={() => onTestPrint(printer)}
      loading={test?.busy ?? false}
      disabled={!canPrint}
      accessibilityLabel={`Test print on ${printer.name}`}
      testID={`${testID}-test`}
    />
  );

  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.head}>
        <View style={[styles.tile, !printer.is_enabled && styles.tileOff]}>
          <Icon name={ROLE_ICONS[printer.role]} size={iconSizes.lg} color={colors.textResting} />
        </View>
        <View style={styles.titles}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>
              {printer.name}
            </Text>
            <StatusDot state={dotState(printer, reachability)} testID={`${testID}-status`} />
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {printer.host}:{printer.port} · {printer.paper_width_mm} mm ({columnsFor(printer.paper_width_mm)} columns)
          </Text>
        </View>
        {wide ? testButton : null}
        {onEdit ? (
          <IconButton
            icon="create-outline"
            variant="soft"
            accessibilityLabel={`Edit ${printer.name}`}
            onPress={() => onEdit(printer)}
            testID={`${testID}-edit`}
          />
        ) : null}
      </View>

      <View style={styles.chips}>
        <Chip label={printerRoleLabel(printer.role)} variant="primary" />
        {printer.is_enabled ? null : <Chip label="Turned off" variant="caution" testID={`${testID}-disabled`} />}
        {printer.is_default_kitchen ? <Chip label="Default kitchen printer" variant="processing" testID={`${testID}-default`} /> : null}
        {routes ? <Chip label={routes} /> : null}
      </View>

      {printer.role === 'cashier' ? (
        <ChoiceChip
          label={isTabletReceiptPrinter ? 'Receipts from this tablet' : 'Use for this tablet’s receipts'}
          icon={isTabletReceiptPrinter ? 'checkmark-circle' : 'ellipse-outline'}
          selected={isTabletReceiptPrinter}
          onPress={() => onUseForReceipts(printer)}
          disabled={!printer.is_enabled}
          testID={`${testID}-receipts`}
        />
      ) : null}

      {wide ? null : testButton}
      {test?.result ? (
        <Banner variant={test.result.ok ? 'success' : 'error'} message={test.result.message} testID={`${testID}-test-result`} />
      ) : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    gap: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tile: {
    width: sizes.thumbnail,
    height: sizes.thumbnail,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOff: {
    backgroundColor: colors.surfaceMuted,
  },
  titles: {
    flex: 1,
    gap: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
