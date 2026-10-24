import { StyleSheet, Text, View } from 'react-native';

import { ReceiptLinesEditor } from '@/components/settings/ReceiptLinesEditor';
import { FormFooter } from '@/components/shared/FormFooter';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection, SectionDivider } from '@/components/shared/FormSection';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { colors, hitTarget, layout, spacing, typography } from '@/constants/theme';
import { RECEIPT_LIMITS, useBranchSettings, useReceiptSettingsForm } from '@/hooks/settings/useReceiptSettingsForm';
import { getPrintTransport } from '@/printing/transport';
import type { BranchSettings } from '@/services/types';
import { goBackOr } from '@/utils/navigation';

function backHome() {
  goBackOr(ROUTES.home);
}

type ReceiptSettingsScreenProps = {
  /** Inside the Settings detail pane (tablets): no top bar, the title shows as the pane heading. */
  embedded?: boolean;
  /** The top bar's back button (full screen only). Default: home. */
  onBack?: () => void;
};

const EMBEDDED_TITLE = 'Receipt';
const EMBEDDED_DESCRIPTION = 'The header and footer on every receipt from this branch, and how the branch prints.';

/** The form, once the settings have loaded (its state starts from them and lives above every layout switch). */
function ReceiptSettingsForm({ settings, embedded, onBack }: { settings: BranchSettings; embedded: boolean; onBack: () => void }) {
  const form = useReceiptSettingsForm(settings);
  const { values, errors, submitting } = form;
  const canPrint = getPrintTransport().available;

  return (
    <FormLayout
      title={embedded ? EMBEDDED_TITLE : 'Receipt settings'}
      subtitle={embedded ? EMBEDDED_DESCRIPTION : null}
      onBack={onBack}
      banner={form.banner}
      fieldErrors={errors}
      footer={
          <FormFooter
            onCancel={embedded ? undefined : onBack}
            cancelDisabled={submitting}
            saveTitle={"Save settings"}
            onSave={form.submit}
            saving={submitting}
            saveDisabled={submitting}
            saveTestID="settings-save"
          />
      }
      notice={form.notice}
      embedded={embedded}
      testID="receipt-settings-screen"
      main={
        <>
          <Card style={styles.section}>
            <ReceiptLinesEditor
              title="Header"
              help="Printed centred at the top of every receipt; the first line in bold. Usually the branch name, address and TIN."
              lines={values.headerLines}
              errors={errors.header}
              onChange={form.setHeaderLines}
              placeholder="e.g. 123 Rizal St., Makati"
              disabled={submitting}
              testIDPrefix="settings-header"
            />
          </Card>
          <Card style={styles.section}>
            <ReceiptLinesEditor
              title="Footer"
              help="Printed centred at the bottom. This is a sales receipt, not an official receipt."
              lines={values.footerLines}
              errors={errors.footer}
              onChange={form.setFooterLines}
              placeholder="e.g. Thank you, come again!"
              disabled={submitting}
              testIDPrefix="settings-footer"
            />
          </Card>
          <FormSection title="Printing" style={styles.rows}>
            <SwitchRow
              label="Print the receipt automatically"
              description="Off: the cashier presses Print receipt after each sale."
              value={values.autoPrint}
              onValueChange={form.setAutoPrint}
              error={errors.autoPrint}
              disabled={submitting}
              testID="settings-auto-print"
            />
            <SectionDivider />
            <View style={styles.copies}>
              <View style={styles.copiesText}>
                <Text style={styles.label}>Receipt copies</Text>
                <Text style={styles.help}>How many receipts print for each sale.</Text>
              </View>
              <QtyStepper
                value={values.copies}
                onChange={form.setCopies}
                min={RECEIPT_LIMITS.minCopies}
                max={RECEIPT_LIMITS.maxCopies}
                accessibilityLabel="Receipt copies"
                disabled={submitting}
                testID="settings-copies"
              />
            </View>
            {errors.copies ? <Text style={styles.error}>{errors.copies}</Text> : null}
            <SectionDivider />
            <SwitchRow
              label="Print kitchen and bar tickets"
              description="Off: no tickets print; the kitchen works from the orders."
              value={values.kitchenTickets}
              onValueChange={form.setKitchenTickets}
              error={errors.kitchenTickets}
              disabled={submitting}
              testID="settings-kitchen-tickets"
            />
          </FormSection>
          <FormSection
            title="Print sample"
            description="Prints the header and footer above (saved or not) on this tablet’s receipt printer."
          >
            {canPrint ? null : <Banner variant="info" message={getPrintTransport().unavailableMessage ?? ''} testID="settings-unavailable" />}
            <Button
              title="Print sample"
              leftIcon="print-outline"
              variant="secondary"
              onPress={form.printSample}
              loading={form.sampling}
              disabled={submitting || !canPrint}
              testID="settings-sample"
            />
            {form.sample ? (
              <Banner variant={form.sample.ok ? 'success' : 'error'} message={form.sample.message} testID="settings-sample-result" />
            ) : null}
          </FormSection>
        </>
      }
    />
  );
}

/**
 * Receipt settings (`settings.manage`; docs/api-contract.md → Printing →
 * Screens): the branch's receipt header and footer, auto-print, copies and
 * kitchen tickets. Loads GET /api/v1/admin/settings (loading, or the error
 * with Retry), then the form. Full screen on phones; the Settings detail
 * pane on tablets (`embedded`).
 */
export function ReceiptSettingsScreen({ embedded = false, onBack = backHome }: ReceiptSettingsScreenProps) {
  const query = useBranchSettings();
  if (query.data) return <ReceiptSettingsForm settings={query.data} embedded={embedded} onBack={onBack} />;
  return (
    <RecordLoadState
      title="Receipt settings"
      error={query.error}
      onRetry={() => void query.refetch()}
      onBack={onBack}
      embedded={embedded}
      testID="settings-load-state"
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  rows: {
    gap: spacing.md,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  copies: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    minHeight: hitTarget.primary,
  },
  copiesText: {
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
    gap: spacing.xxs,
  },
});
