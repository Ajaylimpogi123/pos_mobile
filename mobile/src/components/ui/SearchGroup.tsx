import { useState, type Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, radius, shadows, sizes, spacing, typography } from '@/constants/theme';

type SearchGroupProps = {
  /** The visible label above the group ("Search"). */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** The joined **Search** button and the keyboard's search key. */
  onSubmit: () => void;
  placeholder?: string;
  /** The label sits on the green band: white text (MASTER §2.3: only on its dark side, at 14 / 600). */
  onBand?: boolean;
  /** Shows a clear (×) button inside the input while there is text. */
  onClear?: () => void;
  /** The button's text (default "Search"). */
  buttonLabel?: string;
  /** Results are still catching up with the typed text: a spinner instead of the clear button. */
  busy?: boolean;
  maxLength?: number;
  ref?: Ref<TextInput>;
  /** The group; the input is `inputTestID` (default `<testID>-input`) and its clear button `<inputTestID>-clear`. */
  testID?: string;
  inputTestID?: string;
};

/**
 * The Sell search (MASTER §3 "Search", §6: Sell only): a visible label, then a
 * white input joined to an outline **Search** button (the legacy button
 * group). The group is 48 dp high; the input and the button share one border
 * and an 8 px outer radius. Searching as you type stays with the caller; the
 * button (and the keyboard's search key) calls `onSubmit`.
 */
export function SearchGroup({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  onBand = false,
  onClear,
  buttonLabel = 'Search',
  busy = false,
  maxLength,
  ref,
  testID = 'search-group',
  inputTestID = `${testID}-input`,
}: SearchGroupProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container} testID={testID}>
      <Text style={[styles.label, onBand && styles.labelOnBand]} nativeID={`${testID}-label`} testID={`${testID}-label`}>
        {label}
      </Text>
      <View style={[styles.group, focused && styles.groupFocused]}>
        <View style={styles.field}>
          <Icon name="search" size={iconSizes.md} color={colors.textSecondary} />
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primaryBright}
            cursorColor={colors.green}
            returnKeyType="search"
            maxLength={maxLength}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={label}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={styles.input}
            testID={inputTestID}
          />
          {busy ? <ActivityIndicator color={colors.primaryBright} style={styles.busy} /> : null}
          {!busy && onClear && value !== '' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={onClear}
              hitSlop={CLEAR_SLOP}
              style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
              testID={`${inputTestID}-clear`}
            >
              <Icon name="close-circle" size={iconSizes.md} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
          onPress={onSubmit}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          testID={`${testID}-submit`}
        >
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Grows the 32 dp clear button's touch area to 48. */
const CLEAR_SLOP = (hitTarget.primary - sizes.addBadge) / 2;

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  labelOnBand: {
    color: colors.onGradient,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: hitTarget.primary,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  groupFocused: {
    borderColor: colors.green,
    ...shadows.focusRing,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
  },
  input: {
    ...typography.body,
    flex: 1,
    alignSelf: 'stretch',
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  clear: {
    width: sizes.addBadge,
    height: sizes.addBadge,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  busy: {
    marginRight: spacing.md,
  },
  clearPressed: {
    backgroundColor: colors.accent,
  },
  button: {
    minWidth: hitTarget.primary,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: sizes.borderWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
  },
  buttonPressed: {
    backgroundColor: colors.accent,
  },
  buttonText: {
    ...typography.control,
    color: colors.text,
  },
});
