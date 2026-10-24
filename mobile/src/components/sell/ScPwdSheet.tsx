import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { CheckboxRow } from '@/components/ui/CheckboxRow';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, spacing, typography } from '@/constants/theme';
import type { ScPwdEditor } from '@/hooks/sell/useScPwdEditor';
import { useResponsive } from '@/hooks/useResponsive';
import { describeDiscount } from '@pos/core/sale/discountRules';
import {
  describeConflicts,
  SC_PWD_LIMITS,
  SC_PWD_MODES,
  SC_PWD_PERSON_TYPES,
  VAT_EXEMPT_HINT,
} from '@pos/core/sale/scPwd';
import type { CartLine } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';

type ScPwdSheetProps = {
  editor: ScPwdEditor;
  /** The cart's lines (ticked in `Their items` mode). */
  lines: readonly CartLine[];
  /** The cart already has SC/PWD (the sheet then offers **Remove SC/PWD**). */
  applied: boolean;
  /** The server's `sc_pwd` messages by field path (e.g. `persons.0.id_no`, `diners`, `''`). */
  serverErrors: Record<string, string>;
};

/** The server's messages that belong to no single field of the sheet. */
function generalServerError(serverErrors: Record<string, string>): string | null {
  const fields = Object.keys(serverErrors).filter((path) => !/^persons\.\d+\./.test(path) && path !== 'diners');
  return fields.length > 0 ? serverErrors[fields[0]] : null;
}

/**
 * The SC/PWD sheet (Senior Citizen / PWD Discount → Device rules → Cart and
 * checkout), opened from the cart and from checkout:
 * - persons: each with a type (`Senior citizen` / `PWD`) and a required ID
 *   number (max 30, distinct); one to ten of them;
 * - the mode: `Their items` (tick the cart lines they consume) or
 *   `Shared meal` (a diners stepper, at least the persons count);
 * - **VAT exempt**, unticked by default, with the contract's hint.
 * Apply checks the draft; when discounts SC/PWD can't be combined with are
 * in the cart, a confirmation asks to remove them first. No approval is ever
 * asked. The content scrolls, and stays above the keyboard.
 */
export function ScPwdSheet({ editor, lines, applied, serverErrors }: ScPwdSheetProps) {
  const { isSmallPhone } = useResponsive();
  const { draft, errors } = editor;
  const visible = draft !== null;
  const general = generalServerError(serverErrors);
  const dinersError = errors?.diners ?? serverErrors.diners ?? null;

  return (
    <>
      <BottomSheet visible={visible} onClose={editor.close} closeLabel="Close SC/PWD" testID="sc-pwd-sheet">
        {draft ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flexShrink}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title} accessibilityRole="header">
                  Senior citizen / PWD
                </Text>
                <Text style={styles.subtitle}>20% off their share. No manager approval needed.</Text>
              </View>
              <IconButton icon="close" variant="ghost" accessibilityLabel="Close SC/PWD" onPress={editor.close} testID="sc-pwd-close" />
            </View>

            <ScrollView
              style={styles.flexShrink}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              testID="sc-pwd-scroll"
            >
              {general ? <Banner message={general} testID="sc-pwd-server-error" /> : null}

              <SectionHeader title="Persons" meta={`${draft.persons.length} of ${SC_PWD_LIMITS.maxPersons}`} />
              {draft.persons.map((person, index) => {
                const error =
                  errors?.persons[person.key] ??
                  serverErrors[`persons.${index}.id_no`] ??
                  serverErrors[`persons.${index}.type`] ??
                  null;
                return (
                  <View key={person.key} style={styles.person} testID={`sc-pwd-person-${index}`}>
                    <View style={styles.personTop}>
                      <SegmentedControl
                        options={SC_PWD_PERSON_TYPES.map((option) => ({
                          ...option,
                          testID: `sc-pwd-person-${index}-${option.value}`,
                        }))}
                        value={person.type}
                        onChange={(type) => editor.setPersonType(person.key, type)}
                        accessibilityLabel={`Person ${index + 1} type`}
                        style={styles.flex}
                      />
                      <IconButton
                        icon="trash-outline"
                        variant="ghost"
                        accessibilityLabel={`Remove person ${index + 1}`}
                        onPress={() => editor.removePerson(person.key)}
                        disabled={draft.persons.length <= 1}
                        testID={`sc-pwd-person-${index}-remove`}
                      />
                    </View>
                    <Input
                      label={person.type === 'pwd' ? 'PWD ID number' : 'OSCA ID number'}
                      value={person.idNo}
                      onChangeText={(text) => editor.setPersonId(person.key, text)}
                      error={error}
                      placeholder="e.g. OSCA-12345"
                      maxLength={SC_PWD_LIMITS.idNoMax}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      leftIcon="id-card-outline"
                      testID={`sc-pwd-person-${index}-id`}
                    />
                  </View>
                );
              })}
              <Button
                title="Add person"
                leftIcon="person-add-outline"
                variant="tonal"
                onPress={editor.addPerson}
                disabled={draft.persons.length >= SC_PWD_LIMITS.maxPersons}
                testID="sc-pwd-add-person"
              />

              <SectionHeader title="Discount applies to" />
              <SegmentedControl
                options={SC_PWD_MODES.map((option) => ({ ...option, testID: `sc-pwd-mode-${option.value}` }))}
                value={draft.mode}
                onChange={editor.setMode}
                accessibilityLabel="What the discount applies to"
                testID="sc-pwd-mode"
              />

              {/* As agreed in Q-023: the lines are ticked here; lines added later are ticked by reopening the sheet. */}
              {draft.mode === 'items' ? (
                <View style={styles.group} testID="sc-pwd-lines">
                  <Text style={styles.help}>Tick the items the senior citizen or PWD will eat or drink.</Text>
                  {lines.map((line, index) => {
                    const checked = draft.markedKeys.includes(line.key);
                    return (
                      <CheckboxRow
                        key={line.key}
                        label={`${line.qty} × ${line.product.name}`}
                        description={
                          line.discount
                            ? `${describeDiscount(line.discount)} (removed if ticked)`
                            : undefined
                        }
                        checked={checked}
                        onToggle={() => editor.toggleLine(line.key)}
                        trailing={
                          <Text style={styles.amount} numberOfLines={1}>
                            {formatPeso(line.product.price_cents * line.qty)}
                          </Text>
                        }
                        testID={`sc-pwd-line-${index}`}
                      />
                    );
                  })}
                  {errors?.lines ? (
                    <Text style={styles.error} accessibilityLiveRegion="polite" testID="sc-pwd-lines-error">
                      {errors.lines}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.group} testID="sc-pwd-diners">
                  <Text style={styles.help}>The bill is shared equally: each SC/PWD gets 20% off one diner&apos;s share.</Text>
                  <View style={styles.diners}>
                    <Text style={styles.dinersLabel}>Diners sharing the bill</Text>
                    <QtyStepper
                      value={draft.diners}
                      onChange={editor.setDiners}
                      min={Math.max(1, draft.persons.length)}
                      max={SC_PWD_LIMITS.maxDiners}
                      accessibilityLabel="Diners"
                      testID="sc-pwd-diners-stepper"
                    />
                  </View>
                  {dinersError ? (
                    <Text style={styles.error} accessibilityLiveRegion="polite" testID="sc-pwd-diners-error">
                      {dinersError}
                    </Text>
                  ) : null}
                  <Chip label="Other discounts are removed for a shared meal" variant="neutral" icon="information-circle-outline" />
                </View>
              )}

              <CheckboxRow
                label="VAT exempt"
                description={VAT_EXEMPT_HINT}
                checked={draft.vatExempt}
                onToggle={() => editor.setVatExempt(!draft.vatExempt)}
                testID="sc-pwd-vat-exempt"
              />
            </ScrollView>

            <View style={[styles.actions, isSmallPhone && styles.actionsStacked]}>
              {applied ? (
                <Button
                  title="Remove SC/PWD"
                  leftIcon="trash-outline"
                  variant="danger"
                  onPress={editor.remove}
                  style={styles.action}
                  testID="sc-pwd-remove"
                />
              ) : null}
              <Button title="Cancel" variant="secondary" onPress={editor.close} style={styles.action} testID="sc-pwd-cancel" />
              <Button title="Apply" onPress={editor.apply} style={styles.action} testID="sc-pwd-apply" />
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={editor.pending !== null}
        title="Remove the other discounts?"
        message={editor.pending ? describeConflicts(editor.pending.conflicts) : undefined}
        confirmLabel="Remove and apply"
        icon="pricetags-outline"
        onConfirm={editor.confirmRemoval}
        onCancel={editor.cancelRemoval}
        testID="sc-pwd-conflicts"
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  person: {
    gap: spacing.sm,
  },
  personTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  group: {
    gap: spacing.sm,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.bodyStrong,
    color: colors.primary,
  },
  diners: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dinersLabel: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
  },
});
