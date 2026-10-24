import { useCallback, useState, type ReactNode, type Ref } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TargetedEvent,
  type TextInputProps,
} from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, radius, shadows, sizes, spacing, typography } from '@/constants/theme';

type InputProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string;
  /**
   * `field`: a labelled form field. `search` / `searchSurface`: a white
   * search input with a hairline border (radius 8) and no visible label (the
   * label stays the accessibility label; MASTER §4 allows that for search).
   */
  variant?: 'field' | 'search' | 'searchSurface';
  /** Validation message shown under the field (e.g. the first 422 message). */
  error?: string | null;
  leftIcon?: IconName;
  /** Short text before the value, e.g. "₱" on a money field. */
  prefix?: string;
  /** Rendered inside the field on the right, e.g. a show/hide password IconButton. */
  rightAccessory?: ReactNode;
  ref?: Ref<TextInput>;
};

type FocusEvent = NativeSyntheticEvent<TargetedEvent>;

/**
 * Text input, 48 dp, radius 8: optional left icon and right accessory. Focus
 * shows a 2 px green border and the 2 px focus ring (MASTER §1.1); an error shows a 2 px
 * red border and the message under the field.
 */
export function Input({
  label,
  variant = 'field',
  error,
  leftIcon,
  prefix,
  rightAccessory,
  ref,
  testID,
  onFocus,
  onBlur,
  editable,
  ...inputProps
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);
  const disabled = editable === false;
  const search = variant !== 'field';

  const handleFocus = useCallback(
    (event: FocusEvent) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );
  const handleBlur = useCallback(
    (event: FocusEvent) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  let iconColor: string = colors.textSecondary;
  if (hasError) iconColor = colors.danger;
  else if (focused) iconColor = colors.primary;

  return (
    <View style={styles.container}>
      {search ? null : <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.field,
          search && styles.fieldSearch,
          variant === 'searchSurface' && styles.fieldSearchSurface,
          focused && styles.fieldFocused,
          hasError && styles.fieldError,
          disabled && styles.fieldDisabled,
        ]}
      >
        {leftIcon ? <Icon name={leftIcon} size={iconSizes.md} color={iconColor} /> : null}
        {prefix ? (
          <Text style={styles.prefix} accessibilityElementsHidden importantForAccessibility="no">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          {...inputProps}
          ref={ref}
          testID={testID}
          editable={editable}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          accessibilityState={{ disabled }}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primaryBright}
          cursorColor={colors.primary}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[styles.input, disabled && styles.inputDisabled]}
        />
        {rightAccessory}
      </View>
      {hasError ? (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Horizontal padding inside the field; a 2 px border takes 1 px of it so the text never shifts. */
const PAD_LEFT = spacing.md + spacing.xxs;
const PAD_RIGHT = spacing.xs;

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xxs,
    minHeight: sizes.inputHeight,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingLeft: PAD_LEFT,
    paddingRight: PAD_RIGHT,
  },
  fieldSearch: {
    minHeight: hitTarget.primary,
    borderRadius: radius.md,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingLeft: spacing.md,
  },
  fieldSearchSurface: {
    borderRadius: radius.md,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fieldFocused: {
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    paddingLeft: PAD_LEFT - 1,
    paddingRight: PAD_RIGHT - 1,
    ...shadows.focusRing,
  },
  fieldError: {
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    paddingLeft: PAD_LEFT - 1,
    paddingRight: PAD_RIGHT - 1,
  },
  fieldDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  input: {
    ...typography.body,
    flex: 1,
    alignSelf: 'stretch',
    color: colors.text,
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
  },
  prefix: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
  },
  inputDisabled: {
    color: colors.textSecondary,
  },
  error: {
    ...typography.captionStrong,
    color: colors.danger,
  },
});
