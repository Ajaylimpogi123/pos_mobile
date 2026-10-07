import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { colors, spacing, typography } from '@/constants/theme';
import { DISCOUNT_TYPES, type DiscountDraft } from '@/sale/discountRules';
import type { DiscountKind } from '@/services/types';

type DiscountFieldsProps = {
  draft: DiscountDraft;
  onChange: (draft: DiscountDraft) => void;
  /** Validation message for the value (e.g. "The discount can't be more than ₱80.00."). */
  error?: string | null;
  /** Line discounts are optional: a switch turns the fields on and off. */
  toggleLabel?: string;
  disabled?: boolean;
  /** Test IDs: `<prefix>-toggle`, `<prefix>-type-<type>`, `<prefix>-kind`, `<prefix>-value`. */
  testIDPrefix: string;
};

const KIND_OPTIONS = [
  { value: 'percent' as const, label: 'Percent (%)', testID: undefined as string | undefined },
  { value: 'amount' as const, label: 'Amount (₱)', testID: undefined as string | undefined },
];

/**
 * The fields of a discount (contract → Discount rules): the type (Promo,
 * Employee, Manual), percent or amount, and the value (a percentage with up
 * to 2 decimals, or a peso amount). Values stay text until the editor applies them.
 */
export function DiscountFields({ draft, onChange, error, toggleLabel, disabled = false, testIDPrefix }: DiscountFieldsProps) {
  const kindOptions = KIND_OPTIONS.map((option) => ({ ...option, testID: `${testIDPrefix}-kind-${option.value}` }));

  return (
    <View style={styles.container}>
      {toggleLabel ? (
        <SwitchRow
          label={toggleLabel}
          value={draft.enabled}
          onValueChange={(enabled) => onChange({ ...draft, enabled })}
          disabled={disabled}
          testID={`${testIDPrefix}-toggle`}
        />
      ) : null}
      {draft.enabled ? (
        <>
          <View style={styles.group}>
            <Text style={styles.label}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {DISCOUNT_TYPES.map((type) => (
                <ChoiceChip
                  key={type.value}
                  label={type.label}
                  selected={draft.type === type.value}
                  onPress={() => onChange({ ...draft, type: type.value })}
                  disabled={disabled}
                  testID={`${testIDPrefix}-type-${type.value}`}
                />
              ))}
            </ScrollView>
          </View>
          <SegmentedControl<DiscountKind>
            options={kindOptions}
            value={draft.kind}
            onChange={(kind) => onChange({ ...draft, kind, value: '' })}
            disabled={disabled}
            accessibilityLabel="Discount kind"
            testID={`${testIDPrefix}-kind`}
          />
          <Input
            label={draft.kind === 'percent' ? 'Percentage' : 'Amount'}
            prefix={draft.kind === 'amount' ? '₱' : undefined}
            value={draft.value}
            onChangeText={(value) => onChange({ ...draft, value })}
            placeholder={draft.kind === 'percent' ? 'e.g. 10 or 12.5' : '0.00'}
            keyboardType="decimal-pad"
            error={error}
            editable={!disabled}
            testID={`${testIDPrefix}-value`}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  group: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
