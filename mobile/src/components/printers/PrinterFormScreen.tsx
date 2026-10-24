import { useRef } from 'react';
import { StyleSheet, Text, type TextInput } from 'react-native';

import { PrinterCategoryField } from '@/components/printers/PrinterCategoryField';
import { FormFooter } from '@/components/shared/FormFooter';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection, SectionDivider } from '@/components/shared/FormSection';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { focusField } from '@/components/ui/ErrorSummary';
import { ROUTES } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import { useAllAdminPrinters } from '@/hooks/printers/useAdminPrinters';
import { PRINTER_LIMITS, usePrinterForm } from '@/hooks/printers/usePrinterForm';
import { useRoutableCategories } from '@/hooks/printers/useRoutableCategories';
import { getPrintTransport } from '@/printing/transport';
import type { PaperWidthMm, Printer, PrinterRole } from '@/services/types';
import { usePrintingStore } from '@/stores/printing';
import { goBackOr } from '@/utils/navigation';
import { showToast } from '@/stores/toast';

type PrinterFormScreenProps = {
  /** The printer to edit; omitted when creating. */
  printer?: Printer;
};

const ROLE_OPTIONS: readonly SegmentOption<PrinterRole>[] = [
  { value: 'cashier', label: 'Receipt', icon: 'receipt-outline', testID: 'printer-role-cashier' },
  { value: 'kitchen', label: 'Kitchen', icon: 'restaurant-outline', testID: 'printer-role-kitchen' },
  { value: 'bar', label: 'Bar', icon: 'wine-outline', testID: 'printer-role-bar' },
];

const WIDTH_OPTIONS: readonly SegmentOption<'58' | '80'>[] = [
  { value: '58', label: '58 mm', testID: 'printer-width-58' },
  { value: '80', label: '80 mm', testID: 'printer-width-80' },
];

function backToList() {
  goBackOr(ROUTES.printers);
}

/** MASTER §6: save success is a toast. */
function savedAndBack() {
  showToast('Printer saved.');
  backToList();
}

/**
 * Create / edit a printer (`settings.manage`; docs/api-contract.md → Printing
 * → Screens): name, role and paper width selectors, address and port, the
 * enabled and default-kitchen switches, and the categories it takes (those
 * routed elsewhere are labelled, e.g. "at Bar"). **Test print** sends the
 * test page to the address being edited, before saving.
 */
export function PrinterFormScreen({ printer }: PrinterFormScreenProps) {
  const form = usePrinterForm({ initial: printer, onSaved: savedAndBack, onDeleted: backToList });
  // Keyboard "Next" moves through the fields.
  const printerPortRef = useRef<TextInput>(null);
  const { values, setField, fieldErrors, busy } = form;
  const categories = useRoutableCategories();
  const adminPrinters = useAllAdminPrinters();
  const cachedPrinters = usePrintingStore((state) => state.config?.printers ?? null);
  const canPrint = getPrintTransport().available;

  // Routes of the other printers: fresh from the server, else from this tablet's cached config.
  const allPrinters = adminPrinters.printers.length > 0 || adminPrinters.isSuccess ? adminPrinters.printers : (cachedPrinters ?? []);
  const otherPrinters = allPrinters.filter((other) => other.id !== form.saved?.id);
  const isTicketPrinter = values.role !== 'cashier';

  return (
    <FormLayout
      title={form.isEdit ? 'Edit printer' : 'New printer'}
      subtitle={form.isEdit ? form.saved?.name : null}
      onBack={backToList}
      banner={form.bannerError}
      fieldErrors={fieldErrors}
      onSelectError={(field) => focusField(field, { port: printerPortRef })}
      footer={
          <FormFooter
            onCancel={backToList}
            cancelDisabled={form.submitting}
            saveTitle={form.isEdit ? 'Save changes' : 'Create printer'}
            onSave={form.submit}
            saving={form.submitting}
            saveDisabled={busy}
            saveTestID="printer-save"
          />
      }
      testID="printer-form-screen"
      main={
        <>
          <FormSection title="Printer">
            <Input
              label="Name"
              value={values.name}
              onChangeText={(text) => setField('name', text)}
              error={fieldErrors.name}
              placeholder="e.g. Kitchen"
              maxLength={PRINTER_LIMITS.name}
              editable={!busy}
              returnKeyType="done"
              testID="printer-name"
            />
            <Text style={styles.label}>Prints</Text>
            <SegmentedControl
              options={ROLE_OPTIONS}
              value={values.role}
              onChange={(role) => setField('role', role)}
              disabled={busy}
              accessibilityLabel="What this printer prints"
              testID="printer-role"
            />
            {fieldErrors.role ? <Text style={styles.error}>{fieldErrors.role}</Text> : null}
            <Input
              label="IP address"
              value={values.host}
              onChangeText={(text) => setField('host', text)}
              error={fieldErrors.host}
              placeholder="e.g. 192.168.1.60"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={PRINTER_LIMITS.host}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => printerPortRef.current?.focus()}
              testID="printer-host"
            />
            <Input
              label="Port"
              value={values.port}
              onChangeText={(text) => setField('port', text)}
              error={fieldErrors.port}
              placeholder="9100"
              keyboardType="number-pad"
              maxLength={5}
              editable={!busy}
              ref={printerPortRef}
              returnKeyType="done"
              testID="printer-port"
            />
            <Text style={styles.label}>Paper width</Text>
            <SegmentedControl
              options={WIDTH_OPTIONS}
              value={values.paperWidth === 58 ? '58' : '80'}
              onChange={(width) => setField('paperWidth', Number(width) as PaperWidthMm)}
              disabled={busy}
              accessibilityLabel="Paper width"
              testID="printer-width"
            />
            {fieldErrors.paper_width_mm ? <Text style={styles.error}>{fieldErrors.paper_width_mm}</Text> : null}
          </FormSection>

          <FormSection title="Status">
            <SwitchRow
              label="Enabled"
              description="A printer that is turned off receives nothing."
              value={values.isEnabled}
              onValueChange={(value) => setField('isEnabled', value)}
              error={fieldErrors.is_enabled}
              disabled={busy}
              testID="printer-enabled"
            />
            {isTicketPrinter ? <SectionDivider /> : null}
            {isTicketPrinter ? (
              <SwitchRow
                label="Default kitchen printer"
                description="Takes the items of every category that has no printer. Only one per branch."
                value={values.isDefaultKitchen}
                onValueChange={(value) => setField('isDefaultKitchen', value)}
                error={fieldErrors.is_default_kitchen}
                disabled={busy}
                testID="printer-default-kitchen"
              />
            ) : null}
          </FormSection>

          {isTicketPrinter ? (
            <FormSection title="Categories">
              <PrinterCategoryField
                categories={categories.categories}
                loading={categories.loading}
                loadError={categories.error}
                selectedIds={values.categoryIds}
                onChange={(ids) => setField('categoryIds', ids)}
                otherPrinters={otherPrinters}
                error={fieldErrors.category_ids}
                disabled={busy}
              />
            </FormSection>
          ) : null}

          <FormSection title="Test print">
            <Text style={styles.help}>Sends a test page to the address above, saved or not, to check it is the right printer.</Text>
            {canPrint ? null : <Banner variant="info" message={getPrintTransport().unavailableMessage ?? ''} testID="printer-form-unavailable" />}
            <Button
              title="Test print"
              leftIcon="print-outline"
              variant="secondary"
              onPress={form.testPrint}
              loading={form.testing}
              disabled={busy || !canPrint}
              testID="printer-test"
            />
            {form.testResult ? (
              <Banner variant={form.testResult.ok ? 'success' : 'error'} message={form.testResult.message} testID="printer-test-result" />
            ) : null}
          </FormSection>

          {form.isEdit ? (
            <Button
              title="Delete printer"
              leftIcon="trash-outline"
              variant="danger"
              onPress={form.deleteDialog.request}
              disabled={busy}
              testID="printer-delete"
            />
          ) : null}
        </>
      }
    >
      <ConfirmDialog
        visible={form.deleteDialog.visible}
        title="Delete printer?"
        message={`“${form.saved?.name ?? values.name}” stops receiving receipts and tickets. Its categories go back to the default kitchen printer.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-printer-dialog"
      />
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  label: {
    ...typography.label,
    color: colors.text,
    marginBottom: -spacing.sm,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
