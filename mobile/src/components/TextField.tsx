import { useState, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fontSizes, fontWeights, radii, sizes, spacing } from '@/constants/theme';

type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string;
  /** Validation message shown under the field (e.g. the first 422 message). */
  error?: string | null;
  ref?: Ref<TextInput>;
};

/** Labelled text input with an error message underneath. */
export function TextField({ label, error, ref, testID, onFocus, onBlur, ...inputProps }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        ref={ref}
        testID={testID}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        placeholderTextColor={colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          hasError && styles.inputError,
          inputProps.editable === false && styles.inputDisabled,
        ]}
      />
      {hasError ? (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  input: {
    minHeight: sizes.inputHeight,
    borderWidth: sizes.borderWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontSize: fontSizes.lg,
    color: colors.text,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: sizes.borderWidthStrong,
  },
  inputError: {
    borderColor: colors.errorText,
    borderWidth: sizes.borderWidthStrong,
  },
  inputDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  error: {
    fontSize: fontSizes.sm,
    color: colors.errorText,
  },
});
