import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';

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

const StepButton = memo(function StepButton({ icon, tone, accessibilityLabel, disabled, onPress, testID }: StepButtonProps) {
  const plus = tone === 'plus';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        plus ? styles.plus : styles.minus,
        pressed && (plus ? styles.plusPressed : styles.minusPressed),
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={iconSizes.sm} color={plus ? colors.primaryDark : colors.textResting} />
    </Pressable>
  );
});

/** − value + in one bordered group (44 dp buttons, radius 10); each end disables at its limit. */
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
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  button: {
    width: sizes.stepperButton,
    height: sizes.stepperButton,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minus: {
    backgroundColor: colors.background,
  },
  minusPressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: pressedScale }],
  },
  plus: {
    backgroundColor: colors.primarySoft,
  },
  plusPressed: {
    backgroundColor: colors.primarySoftPressed,
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
