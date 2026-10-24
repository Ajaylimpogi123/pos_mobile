import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { FormSection } from '@/components/shared/FormSection';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { colors, layout, numeric, spacing, typography } from '@/constants/theme';
import { INGREDIENT_LIMITS, type IngredientFormState } from '@/hooks/ingredients/useIngredientForm';
import { useResponsive } from '@/hooks/useResponsive';
import type { BaseUnit } from '@/services/types';
import { formatBaseQty, parseFactorInput } from '@pos/core/quantity';

type UnitsEditorProps = {
  editor: IngredientFormState['unitsEditor'];
  baseUnit: BaseUnit;
  disabled: boolean;
  /** A 422 on `units` itself (e.g. too many). */
  error?: string | null;
};

/**
 * The ingredient's own units (§L): each row reads `1 <name> = [factor] <base
 * unit>`, e.g. `1 sack = 25000 g`, with the reserved-code check inline while
 * typing, and each row's 422 under its field. On wide screens a row is one
 * line; on phones the factor wraps under the name.
 */
export function UnitsEditor({ editor, baseUnit, disabled, error }: UnitsEditorProps) {
  const { isPhone, isPortrait } = useResponsive();
  const stacked = isPhone && isPortrait;

  return (
    <FormSection
      title="Units"
      description={`How you buy or measure it, in ${baseUnit}. A standard unit (${baseUnit === 'pc' ? 'dozen' : baseUnit === 'g' ? 'kg, lb' : 'L, cup'}) is already built in.`}
      style={styles.card}
      testID="units-editor"
    >
      {editor.rows.length === 0 ? (
        <Text style={styles.empty} testID="units-editor-empty">
          No own units yet, e.g. a sack of 25,000 g.
        </Text>
      ) : null}
      {editor.rows.map((row, index) => {
        const nameError = editor.errorOf(index, 'name') ?? editor.reservedMessage(row.name);
        const factor = parseFactorInput(row.factor);
        const hint = factor.ok && row.name.trim() !== '' ? `1 ${row.name.trim()} = ${formatBaseQty(factor.value, baseUnit)}` : null;
        return (
          <View key={row.key} style={styles.row} testID={`unit-row-${index}`}>
            <View style={[styles.fields, stacked && styles.fieldsStacked]}>
              <View style={styles.name}>
                <Input
                  label={`Unit ${index + 1}`}
                  value={row.name}
                  onChangeText={(text) => editor.setName(index, text)}
                  placeholder="e.g. sack"
                  prefix="1"
                  maxLength={INGREDIENT_LIMITS.unitName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={nameError}
                  editable={!disabled}
                  testID={`unit-row-${index}-name`}
                />
              </View>
              <View style={styles.factor}>
                <Input
                  label={`= how many ${baseUnit}`}
                  value={row.factor}
                  onChangeText={(text) => editor.setFactor(index, text.replace(/[^0-9.]/g, ''))}
                  placeholder="e.g. 25000"
                  keyboardType="decimal-pad"
                  maxLength={18}
                  error={editor.errorOf(index, 'factor')}
                  editable={!disabled}
                  rightAccessory={<Text style={styles.suffix}>{baseUnit}</Text>}
                  testID={`unit-row-${index}-factor`}
                />
              </View>
              <IconButton
                icon="trash-outline"
                variant="ghost"
                accessibilityLabel={`Remove unit ${row.name.trim() || index + 1}`}
                onPress={() => editor.remove(row.key)}
                disabled={disabled}
                style={stacked ? styles.removeStacked : styles.remove}
                testID={`unit-row-${index}-remove`}
              />
            </View>
            {hint ? (
              <Text style={styles.hint} testID={`unit-row-${index}-hint`}>
                {hint}
              </Text>
            ) : null}
          </View>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        title="Add unit"
        leftIcon="add"
        variant="tonal"
        onPress={editor.add}
        disabled={disabled || editor.rows.length >= INGREDIENT_LIMITS.units}
        testID="units-editor-add"
      />
    </FormSection>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  row: {
    gap: spacing.xs,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  fields: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  fieldsStacked: {
    flexWrap: 'wrap',
  },
  name: {
    flexGrow: 1,
    flexBasis: layout.unitNameMinWidth,
  },
  factor: {
    flexGrow: 1,
    flexBasis: layout.unitFactorMinWidth,
  },
  remove: {
    // Centres the 44 dp button on the 52 dp input under its label (label 18 + gap 8 + 4).
    marginTop: spacing.xxl + spacing.xs + spacing.xxs,
  },
  removeStacked: {
    alignSelf: 'flex-end',
  },
  suffix: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    marginHorizontal: spacing.md,
  },
  hint: {
    ...typography.bodySm,
    ...numeric,
    color: colors.primary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
