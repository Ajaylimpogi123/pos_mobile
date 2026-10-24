import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type QtyStepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** Screen-reader name, e.g. "Iced Tea quantity". */
  accessibilityLabel: string;
  disabled?: boolean;
  testID: string;
};

type StepButtonProps = {
  icon: IconName;
  tone: 'minus' | 'plus';
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
};

/** Grows each 44 dp step button's touch area to 48 (MASTER §6). */
const STEP_SLOP = (hitTarget.primary - sizes.stepperButton) / 2;

const StepButton = memo(function StepButton({ icon, tone, accessibilityLabel, disabled, onPress, testID }: StepButtonProps) {
  const plus = tone === 'plus';
  const reduceMotion = useReducedMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={STEP_SLOP}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        plus ? styles.plus : styles.minus,
        pressed && (plus ? styles.plusPressed : styles.minusPressed),
        pressed && !reduceMotion && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={iconSizes.sm} color={plus ? colors.onPrimary : colors.text} />
    </Pressable>
  );
});

/** The round stepper (MASTER §1.6 / §3): − value + in one pill-shaped group (44 dp round buttons, a 48 touch area); each end disables at its limit. */
export function QtyStepper({ value, onChange, min = 1, max, accessibilityLabel, disabled = false, testID }: QtyStepperProps) {
  const decrease = useCallback(() => onChange(value - 1), [onChange, value]);
  const increase = useCallback(() => onChange(value + 1), [onChange, value]);

  return (
    <View style={styles.group} testID={testID}>
      <StepButton
        icon="remove"
        tone="minus"
        accessibilityLabel={`Decrease ${accessibilityLabel}`}
        onPress={decrease}
        disabled={disabled || value <= min}
        testID={`${testID}-minus`}
      />
      <Text
        style={styles.value}
        accessibilityLabel={`${accessibilityLabel}: ${value}`}
        numberOfLines={1}
        testID={`${testID}-value`}
      >
        {value}
      </Text>
      <StepButton
        icon="add"
        tone="plus"
        accessibilityLabel={`Increase ${accessibilityLabel}`}
        onPress={increase}
        disabled={disabled || value >= max}
        testID={`${testID}-plus`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xxs,
    padding: spacing.xxs,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  button: {
    width: sizes.stepperButton,
    height: sizes.stepperButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minus: {
    backgroundColor: colors.accent,
  },
  minusPressed: {
    backgroundColor: colors.borderStrong,
  },
  plus: {
    backgroundColor: colors.green,
  },
  plusPressed: {
    backgroundColor: colors.greenHover,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  disabled: {
    opacity: opacity.disabled,
  },
  value: {
    ...typography.heading,
    ...numeric,
    color: colors.text,
    minWidth: sizes.stepperValue,
    textAlign: 'center',
  },
});
