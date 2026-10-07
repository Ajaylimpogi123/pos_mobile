import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import {
  colors,
  iconSizes,
  layout,
  opacity,
  pressedScale,
  radius,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import { PIN_LENGTH } from '@/utils/pin';

type PinPadProps = {
  value: string;
  onChange: (value: string) => void;
  /** Screen-reader name of the entry, e.g. "PIN for Marco Manager". */
  accessibilityLabel: string;
  disabled?: boolean;
  /** Shown under the dots (e.g. "Incorrect PIN."). */
  error?: string | null;
  testID: string;
};

type Key = { id: string; label: string; accessibilityLabel: string };

const KEYS: readonly Key[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => ({ id: digit, label: digit, accessibilityLabel: digit })),
  { id: 'clear', label: 'Clear', accessibilityLabel: 'Clear PIN' },
  { id: '0', label: '0', accessibilityLabel: '0' },
  { id: 'back', label: '', accessibilityLabel: 'Delete last digit' },
];

/**
 * A large on-screen PIN pad for counter use (no keyboard needed): dots for the
 * digits entered (never the digits themselves), then 1–9, Clear, 0 and
 * Delete as 56 dp rounded keys (radius 14) with pressed and disabled states. Accepts up to
 * 6 digits (the contract's 4–6); the caller decides when it is complete.
 */
export function PinPad({ value, onChange, accessibilityLabel, disabled = false, error, testID }: PinPadProps) {
  const slots = Math.max(PIN_LENGTH.min, value.length);

  function press(key: Key) {
    if (key.id === 'clear') onChange('');
    else if (key.id === 'back') onChange(value.slice(0, -1));
    else if (value.length < PIN_LENGTH.max) onChange(value + key.id);
  }

  return (
    <View style={styles.pad} testID={testID}>
      <View
        style={styles.dots}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${accessibilityLabel}: ${value.length} of ${PIN_LENGTH.min} to ${PIN_LENGTH.max} digits entered`}
        testID={`${testID}-dots`}
      >
        {Array.from({ length: slots }, (_unused, index) => (
          <View key={index} style={[styles.dot, index < value.length ? styles.dotFilled : styles.dotEmpty]} />
        ))}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
      <View style={styles.keys}>
        {KEYS.map((key) => {
          const keyDisabled =
            disabled || (key.id.length === 1 && value.length >= PIN_LENGTH.max) || (key.id.length > 1 && value === '');
          return (
            <View key={key.id} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={key.accessibilityLabel}
                accessibilityState={{ disabled: keyDisabled }}
                disabled={keyDisabled}
                onPress={() => press(key)}
                testID={`${testID}-key-${key.id}`}
                style={({ pressed }) => [
                  styles.key,
                  key.id.length > 1 && styles.keyAction,
                  pressed && styles.keyPressed,
                  keyDisabled && styles.keyDisabled,
                ]}
              >
                {key.id === 'back' ? (
                  <Icon name="backspace-outline" size={iconSizes.lg} color={colors.text} />
                ) : (
                  <Text style={key.id.length > 1 ? styles.actionLabel : styles.digit}>{key.label}</Text>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    width: '100%',
    maxWidth: layout.pinPadMaxWidth,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm + spacing.xxs,
    minHeight: sizes.pinDot + spacing.sm,
    alignItems: 'center',
  },
  dot: {
    width: sizes.pinDot,
    height: sizes.pinDot,
    borderRadius: radius.pill,
    borderWidth: sizes.borderWidthFocus,
  },
  dotFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dotEmpty: {
    backgroundColor: colors.transparent,
    borderColor: colors.borderStrong,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
    textAlign: 'center',
  },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  cell: {
    width: '33.333%',
    padding: spacing.xs,
  },
  key: {
    height: sizes.pinKey,
    borderRadius: radius.cta,
    backgroundColor: colors.surface,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyAction: {
    backgroundColor: colors.background,
  },
  keyPressed: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoftPressed,
    transform: [{ scale: pressedScale }],
  },
  keyDisabled: {
    opacity: opacity.disabled,
  },
  digit: {
    ...typography.pinKey,
    color: colors.text,
  },
  actionLabel: {
    ...typography.label,
    color: colors.text,
  },
});
