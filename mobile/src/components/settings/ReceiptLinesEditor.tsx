import { useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { SectionLabel } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/constants/theme';
import { RECEIPT_LIMITS, type LinesErrors } from '@/hooks/settings/useReceiptSettingsForm';

type ReceiptLinesEditorProps = {
  title: string;
  help: string;
  lines: readonly string[];
  errors: LinesErrors;
  onChange: (lines: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  /** Test IDs: `<prefix>-<n>` per line, `<prefix>-<n>-remove`, `<prefix>-add`. */
  testIDPrefix: string;
};

/** An editable list of receipt lines (up to 6, 48 characters each): add, edit, remove, under an uppercase section label. */
export function ReceiptLinesEditor({ title, help, lines, errors, onChange, placeholder, disabled = false, testIDPrefix }: ReceiptLinesEditorProps) {
  // "Next" on the keyboard moves to the following line.
  const inputs = useRef<(TextInput | null)[]>([]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SectionLabel>{title}</SectionLabel>
        <Text style={styles.help}>{help}</Text>
      </View>
      {lines.map((line, index) => (
        <Input
          key={index}
          label={`Line ${index + 1}`}
          value={line}
          onChangeText={(text) => onChange(lines.map((current, position) => (position === index ? text : current)))}
          error={errors.lines[index]}
          placeholder={placeholder}
          maxLength={RECEIPT_LIMITS.lineLength}
          editable={!disabled}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          returnKeyType={index < lines.length - 1 ? 'next' : 'done'}
          submitBehavior={index < lines.length - 1 ? 'submit' : 'blurAndSubmit'}
          onSubmitEditing={() => inputs.current[index + 1]?.focus()}
          testID={`${testIDPrefix}-${index}`}
          rightAccessory={
            <IconButton
              icon="close-circle-outline"
              variant="ghost"
              accessibilityLabel={`Remove line ${index + 1}`}
              onPress={() => onChange(lines.filter((_line, position) => position !== index))}
              disabled={disabled}
              testID={`${testIDPrefix}-${index}-remove`}
            />
          }
        />
      ))}
      {errors.list ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testIDPrefix}-error`}>
          {errors.list}
        </Text>
      ) : null}
      <Button
        title="Add line"
        leftIcon="add"
        variant="ghost"
        onPress={() => onChange([...lines, ''])}
        disabled={disabled || lines.length >= RECEIPT_LIMITS.maxLines}
        style={styles.add}
        testID={`${testIDPrefix}-add`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  add: {
    alignSelf: 'flex-start',
  },
});
