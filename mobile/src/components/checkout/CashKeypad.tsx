import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';

type CashKeypadProps = {
  /** The cash as typed (the same text as the Cash received field). */
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  testID: string;
};

/** Whole-peso digits accepted (the contract caps a payment at ₱10,000,000). */
const MAX_WHOLE_DIGITS = 8;

type Key = { id: string; label: string; accessibilityLabel: string };

const KEYS: readonly Key[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((digit) => ({
    id: digit,
    label: digit,
    accessibilityLabel: digit === '00' ? 'Double zero' : digit,
  })),
  { id: 'back', label: '', accessibilityLabel: 'Delete last digit' },
];

/**
 * `"12"` + `"5"` → `"125"`. Appends digits to the cash text: no leading
 * zeros, at most 2 decimals (after an "Exact" amount such as `257.50`) and
 * at most 8 whole digits. Returns the text unchanged when the key can't apply.
 */
export function appendCashKey(text: string, key: string): string {
  const current = text.replace(/,/g, '').trim();
  const [whole, decimals] = current.split('.');
  if (decimals !== undefined) return decimals.length + key.length <= 2 ? current + key : current;
  if (whole === '' || whole === '0') {
    const digits = key.replace(/^0+/, '');
    return digits === '' ? current : digits;
  }
  return whole.length + key.length <= MAX_WHOLE_DIGITS ? current + key : current;
}

type KeyButtonProps = {
  item: Key;
  disabled: boolean;
  onKey: (id: string) => void;
  onClear: () => void;
  testID: string;
};

const KeyButton = memo(function KeyButton({ item, disabled, onKey, onClear, testID }: KeyButtonProps) {
  const back = item.id === 'back';
  const press = useCallback(() => onKey(item.id), [onKey, item.id]);
  return (
    <View style={styles.cell}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.accessibilityLabel}
        accessibilityHint={back ? 'Hold to clear the amount' : undefined}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={press}
        onLongPress={back ? onClear : undefined}
        style={({ pressed }) => [styles.key, back && styles.keyAction, pressed && styles.keyPressed, disabled && styles.keyDisabled]}
        testID={`${testID}-key-${item.id}`}
      >
        {back ? (
          <Icon name="backspace-outline" size={iconSizes.lg} color={colors.text} />
        ) : (
          <Text style={styles.digit}>{item.label}</Text>
        )}
      </Pressable>
    </View>
  );
});

/**
 * An on-screen number pad for the cash handed over (Checkout board): 1–9,
 * 00, 0 and delete (hold it to clear), as 64 dp keys with immediate pressed
 * feedback. It edits the same text as the Cash received field (which still
 * takes the keyboard, e.g. for centavos).
 */
export function CashKeypad({ value, onChange, disabled = false, testID }: CashKeypadProps) {
  const onKey = useCallback(
    (id: string) => {
      if (id === 'back') onChange(value.slice(0, -1));
      else onChange(appendCashKey(value, id));
    },
    [onChange, value],
  );
  const onClear = useCallback(() => onChange(''), [onChange]);

  return (
    <View style={styles.pad} testID={testID}>
      {KEYS.map((item) => (
        <KeyButton
          key={item.id}
          item={item}
          disabled={disabled || (item.id === 'back' && value === '')}
          onKey={onKey}
          onClear={onClear}
          testID={testID}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  cell: {
    width: '33.333%',
    padding: spacing.xs,
  },
  key: {
    height: sizes.keypadKey,
    borderRadius: radius.cta,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
});
