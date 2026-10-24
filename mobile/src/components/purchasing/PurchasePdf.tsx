/**
 * Purchase Request & Order PDF, revision 2 (v1.27 §G): the tablet's pieces.
 * - `PdfButton`: **PDF** (outline), a spinner while it loads, disabled and
 *   reading "Needs a connection" offline.
 * - `PdfErrorBanner`: the §E message (404 / 403 / other) with Retry.
 * - `PurchasePdfSheet`: on a PO with several suppliers it first asks All
 *   suppliers or one (§D.6); then the preview with **Print / Save as PDF**
 *   and **Share**, plus a banner when either fails.
 * State lives in `usePurchasePdf` (one per screen), above any layout switch.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { colors, layout, numeric, radius, spacing, typography } from '@/constants/theme';
import { PDF_OFFLINE_LABEL, pdfTargetKey, type PdfTarget, type PurchasePdfState } from '@/hooks/purchasing/usePurchasePdf';
import { useResponsive } from '@/hooks/useResponsive';
import { formatPeso } from '@pos/core/money';
import { prEstimateTotals, selectSupplierGroups } from '@pos/core/purchasing/printModel';

type PdfButtonProps = {
  pdf: PurchasePdfState;
  target: PdfTarget;
  /** Default "PDF". */
  title?: string;
  /** Spoken label, e.g. "PDF of PO-MAIN-2026-00002". */
  accessibilityLabel?: string;
  testID?: string;
};

export function PdfButton({ pdf, target, title = 'PDF', accessibilityLabel, testID }: PdfButtonProps) {
  const loading = pdf.loadingKey === pdfTargetKey(target);
  return (
    <Button
      title={pdf.online ? title : PDF_OFFLINE_LABEL}
      leftIcon="document-text-outline"
      variant="secondary"
      onPress={() => pdf.open(target)}
      loading={loading}
      disabled={!pdf.online || (pdf.loadingKey !== null && !loading)}
      accessibilityLabel={pdf.online ? accessibilityLabel : `${accessibilityLabel ?? title}: ${PDF_OFFLINE_LABEL}`}
      testID={testID}
    />
  );
}

/** §E: the failed read's message with Retry (and Dismiss). */
export function PdfErrorBanner({ pdf, testID }: { pdf: PurchasePdfState; testID?: string }) {
  if (!pdf.error) return null;
  return (
    <View style={styles.errorBox} testID={testID}>
      <Banner message={pdf.error} testID={testID ? `${testID}-message` : undefined} />
      <View style={styles.errorActions}>
        <Button title="Dismiss" variant="ghost" onPress={pdf.dismissError} testID={testID ? `${testID}-dismiss` : undefined} />
        <Button
          title="Retry"
          leftIcon="refresh"
          variant="secondary"
          onPress={pdf.retry}
          loading={pdf.loadingKey !== null && pdf.loadingKey === pdf.errorKey}
          disabled={!pdf.online}
          testID={testID ? `${testID}-retry` : undefined}
        />
      </View>
    </View>
  );
}

function SummaryLine({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function lineCount(count: number, word: 'line' | 'item'): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The pick step and the preview step of the PDF. */
export function PurchasePdfSheet({ pdf, testID = 'pdf-sheet' }: { pdf: PurchasePdfState; testID?: string }) {
  const { cardPadding, gutter, isTablet } = useResponsive();
  const prepared = pdf.prepared;
  const picking = prepared?.kind === 'po' && pdf.supplierId === undefined;

  let body = null;
  if (prepared && picking && prepared.kind === 'po') {
    body = (
      <>
        <Text style={styles.prompt}>Which suppliers should the PDF include?</Text>
        <View>
          <ListRow
            label="All suppliers"
            subLabel={`${lineCount(prepared.po.lines.length, 'line')} · each supplier on its own page`}
            value={formatPeso(prepared.po.total_cents)}
            icon="layers-outline"
            tone="primary"
            divider
            onPress={() => pdf.pickSupplier(null)}
            testID={`${testID}-all`}
          />
          {prepared.groups.map((group) => (
            <ListRow
              key={group.supplier.id}
              label={group.supplier.name}
              subLabel={`${lineCount(group.lines.length, 'line')} · the copy to send to this supplier`}
              value={formatPeso(group.subtotalCents)}
              icon="business-outline"
              divider
              onPress={() => pdf.pickSupplier(group.supplier.id)}
              testID={`${testID}-supplier-${group.supplier.id}`}
            />
          ))}
        </View>
      </>
    );
  } else if (prepared) {
    let lines: { label: string; value: string; testID: string }[];
    if (prepared.kind === 'pr') {
      const totals = prEstimateTotals(prepared.pr.items);
      lines = [
        { label: 'Items', value: lineCount(prepared.pr.items.length, 'item'), testID: `${testID}-count` },
        { label: 'Estimated total', value: totals.totalCents === null ? '—' : formatPeso(totals.totalCents), testID: `${testID}-total` },
      ];
    } else {
      const selection = selectSupplierGroups(prepared.po, pdf.supplierId ?? null);
      const count = selection.groups.reduce((sum, group) => sum + group.lines.length, 0);
      lines = [
        { label: 'Suppliers', value: selection.only ? `${selection.only.name} only` : 'All suppliers', testID: `${testID}-suppliers` },
        { label: 'Lines', value: lineCount(count, 'line'), testID: `${testID}-count` },
        { label: selection.only ? 'Total' : 'Grand total', value: formatPeso(selection.totalCents), testID: `${testID}-total` },
      ];
    }
    const multiSupplier = prepared.kind === 'po' && prepared.groups.length > 1;
    body = (
      <>
        <View style={styles.summary}>
          {lines.map((line) => (
            <SummaryLine key={line.label} label={line.label} value={line.value} testID={line.testID} />
          ))}
          <SummaryLine label="File name" value={`${prepared.number}.pdf`} />
        </View>
        <Text style={styles.hint}>A4 portrait. Print / Save as PDF opens Android’s print screen: pick a printer or “Save as PDF”.</Text>
        {pdf.actionError ? <Banner message={pdf.actionError} testID={`${testID}-error`} /> : null}
        <View style={styles.actions}>
          <Button
            title="Print / Save as PDF"
            leftIcon="print-outline"
            onPress={pdf.print}
            loading={pdf.busy === 'print'}
            disabled={pdf.busy !== null || pdf.html === null}
            style={[styles.action, isTablet ? null : styles.actionFull]}
            testID={`${testID}-print`}
          />
          <Button
            title="Share"
            leftIcon="share-social-outline"
            variant="secondary"
            onPress={pdf.share}
            loading={pdf.busy === 'share'}
            disabled={pdf.busy !== null || pdf.html === null}
            style={[styles.action, isTablet ? null : styles.actionFull]}
            testID={`${testID}-share`}
          />
        </View>
        {multiSupplier ? (
          <Button title="Change suppliers" leftIcon="swap-horizontal" variant="ghost" onPress={pdf.changeSupplier} disabled={pdf.busy !== null} testID={`${testID}-change`} />
        ) : null}
      </>
    );
  }

  const title = prepared ? `${prepared.kind === 'pr' ? 'Purchase request' : 'Purchase order'} ${prepared.number}` : '';

  return (
    <BottomSheet visible={prepared !== null} onClose={pdf.close} closeLabel="Close the PDF" testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { padding: cardPadding, gap: gutter }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2} testID={`${testID}-title`}>
              {title}
            </Text>
            <Text style={styles.subtitle}>{picking ? 'Choose the suppliers' : 'PDF preview'}</Text>
          </View>
          <Button title="Close" variant="ghost" onPress={pdf.close} disabled={pdf.busy !== null} testID={`${testID}-close`} />
        </View>
        {body}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  errorBox: {
    gap: spacing.sm,
  },
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  content: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  prompt: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  summary: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryLabel: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  summaryValue: {
    ...typography.label,
    ...numeric,
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  action: {
    flexGrow: 1,
    flexBasis: layout.sectionTitleMinWidth * 2,
  },
  actionFull: {
    flexBasis: '100%',
  },
});
