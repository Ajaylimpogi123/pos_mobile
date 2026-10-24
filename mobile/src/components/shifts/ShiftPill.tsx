import { Pressable, StyleSheet } from 'react-native';

import { Chip, STATUS_CHIP_HIT_SLOP } from '@/components/ui/Chip';
import { opacity, pressedScale, radius } from '@/constants/theme';
import type { LocalShift } from '@/db/shiftRepository';
import { useSessionStore } from '@/stores/session';
import { formatBranchTime } from '@pos/core/businessDay';

type ShiftPillProps = {
  shift: LocalShift;
  onPress: () => void;
  /** Phones in portrait: the clock icon only (the label stays the accessibility label). */
  iconOnly?: boolean;
};

/** "Shift since 8:02 AM" (branch time). */
export function shiftSinceLabel(shift: LocalShift, timeZone: string): string {
  const time = formatBranchTime(shift.openedAt, timeZone);
  return time ? `Shift since ${time}` : 'Shift open';
}

/**
 * The Sell top bar's shift status chip (docs/api-contract.md → Shifts & Reporting →
 * Shift gate): `Shift since 8:02 AM`. Tapping it opens the shift menu
 * (Cash in, Cash out, X-read, Close shift).
 */
export function ShiftPill({ shift, onPress, iconOnly = false }: ShiftPillProps) {
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const label = shiftSinceLabel(shift, timeZone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the shift menu: cash in, cash out, X-read and close shift"
      onPress={onPress}
      hitSlop={STATUS_CHIP_HIT_SLOP}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      testID="shift-pill"
    >
      <Chip label={label} variant="primary" icon="time-outline" size="bar" iconOnly={iconOnly} testID="shift-pill-label" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: opacity.dimmed,
    transform: [{ scale: pressedScale }],
  },
});
