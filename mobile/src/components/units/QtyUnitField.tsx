import type { Ref } from 'react';
import { StyleSheet, Text, View, type TextInput, type TextInputProps } from 'react-native';

import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/constants/theme';
import { formatBaseQty, parseQtyInput, toBaseQty } from '@pos/core/quantity';
import { findUnit, type UnitChoices, type UnitOption } from '@pos/core/units';

/**
 * The live base preview (§L): `= 50,000 g (50 kg)` for 2 sack of a 25,000 g
 * sack, computed with `BigInt` (`round_half_up(qty × factor, 3)`); `null`
 * when the quantity isn't readable yet or the unit is the base unit itself.
 */
export function basePreview(qtyText: string, unitCode: string, choices: UnitChoices, allowNegative = false): string | null {
  if (unitCode === choices.baseUnit) return null;
  const unit = findUnit(choices, unitCode);
  const qty = parseQtyInput(qtyText, { allowNegative, allowZero: true });
  if (!unit || !qty.ok) return null;
  const base = toBaseQty(qty.value, unit.factor);
  return base === null ? null : `= ${formatBaseQty(base, choices.baseUnit)}`;
}

type UnitChipsProps = {
  choices: UnitChoices;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  testID: string;
};

function Group({ label, options, props }: { label: string; options: UnitOption[]; props: UnitChipsProps }) {
  if (options.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => (
          <ChoiceChip
            key={`${option.group}-${option.code}`}
            label={option.code}
            selected={props.value === option.code}
            onPress={() => props.onChange(option.code)}
            disabled={props.disabled}
            testID={`${props.testID}-${option.code}`}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The unit picker (§L): only the item's valid units, grouped as *This
 * ingredient's units* and then the standard units of its dimension. A
 * product shows its one unit (`pc`) as plain text.
 */
export function UnitChips(props: UnitChipsProps) {
  const { choices, testID } = props;
  if (choices.own.length === 0 && choices.catalog.length <= 1) {
    return (
      <Text style={styles.single} testID={`${testID}-single`}>
        Unit: {choices.catalog[0]?.code ?? choices.baseUnit}
      </Text>
    );
  }
  return (
    <View style={styles.groups} testID={testID}>
      <Group label="This ingredient's units" options={choices.own} props={props} />
      <Group label="Standard units" options={choices.catalog} props={props} />
    </View>
  );
}

type QtyUnitFieldProps = {
  label: string;
  qty: string;
  onQtyChange: (text: string) => void;
  unit: string;
  onUnitChange: (code: string) => void;
  choices: UnitChoices;
  /** The qty's error (client or 422). */
  error?: string | null;
  /** The unit's 422 (e.g. `Add "tbsp" to Flour's units first.`). */
  unitError?: string | null;
  editable?: boolean;
  /** Corrections and adjustments accept a leading minus. */
  allowNegative?: boolean;
  placeholder?: string;
  /** The qty input, e.g. to focus it from the previous field in a "Next" chain. */
  inputRef?: Ref<TextInput>;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  submitBehavior?: TextInputProps['submitBehavior'];
  testID: string;
};

/**
 * A quantity with its unit and the live base preview underneath. The server's
 * `base_qty` is what counts after saving; this preview is only a guide.
 */
export function QtyUnitField({
  label,
  qty,
  onQtyChange,
  unit,
  onUnitChange,
  choices,
  error,
  unitError,
  editable = true,
  allowNegative = false,
  placeholder = 'e.g. 2.5',
  inputRef,
  returnKeyType,
  onSubmitEditing,
  submitBehavior,
  testID,
}: QtyUnitFieldProps) {
  const preview = basePreview(qty, unit, choices, allowNegative);
  return (
    <View style={styles.container}>
      <Input
        label={label}
        value={qty}
        onChangeText={(text) => onQtyChange(text.replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, ''))}
        ref={inputRef}
        placeholder={placeholder}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        submitBehavior={submitBehavior}
        keyboardType={allowNegative ? 'numbers-and-punctuation' : 'decimal-pad'}
        maxLength={12}
        error={error}
        editable={editable}
        rightAccessory={
          <Text style={styles.unitSuffix} testID={`${testID}-unit`}>
            {unit}
          </Text>
        }
        testID={`${testID}-qty`}
      />
      <UnitChips choices={choices} value={unit} onChange={onUnitChange} disabled={!editable} testID={`${testID}-units`} />
      {unitError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-unit-error`}>
          {unitError}
        </Text>
      ) : null}
      {preview ? (
        <Text style={styles.preview} accessibilityLiveRegion="polite" testID={`${testID}-preview`}>
          {preview}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  groups: {
    gap: spacing.sm,
  },
  group: {
    gap: spacing.xs,
  },
  groupLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  single: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  unitSuffix: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    marginHorizontal: spacing.md,
  },
  preview: {
    ...typography.bodyStrong,
    color: colors.primary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
