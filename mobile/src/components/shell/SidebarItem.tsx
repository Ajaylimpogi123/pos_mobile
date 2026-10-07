import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import type { ModuleDefinition } from '@/constants/modules';
import { iconSizes, opacity, radius, sidebar, spacing, typography } from '@/constants/theme';

type SidebarItemProps = {
  module: ModuleDefinition;
  active: boolean;
  /** `expanded`: a labelled row. `rail`: an icon-only rounded square. */
  variant: 'expanded' | 'rail';
  onPress: (module: ModuleDefinition) => void;
};

/**
 * One sidebar module: 44 high rows, 48 rail buttons, with immediate pressed
 * (a colour change, no animation), selected and disabled states. The active
 * item is a soft-green pill with dark-emerald bold text and a primary icon;
 * the others are quiet rows. "Soon" modules are disabled and carry a small
 * "Soon" tag (the rail says so in the accessibility label).
 */
export const SidebarItem = memo(function SidebarItem({ module, active, variant, onPress }: SidebarItemProps) {
  const disabled = module.status === 'soon';
  const accessibilityLabel = disabled ? `${module.label}, coming soon` : module.label;
  const textColor = active ? sidebar.colors.activeText : sidebar.colors.itemText;
  const iconColor = active ? sidebar.colors.activeIcon : sidebar.colors.itemText;
  const testID = `sidebar-item-${module.key}`;
  const rail = variant === 'rail';
  const handlePress = useCallback(() => onPress(module), [onPress, module]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={module.hint}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={handlePress}
      testID={testID}
      style={({ pressed }) => [
        rail ? styles.railItem : styles.item,
        active ? styles.active : styles.resting,
        pressed && (active ? styles.activePressed : styles.restingPressed),
        disabled && styles.disabled,
      ]}
    >
      <Icon name={active ? module.activeIcon : module.icon} size={rail ? iconSizes.lg : iconSizes.md} color={iconColor} />
      {rail ? null : (
        <Text style={[active ? styles.labelActive : styles.label, { color: textColor }]} numberOfLines={1}>
          {module.label}
        </Text>
      )}
      {!rail && disabled ? (
        <View style={styles.soonTag} testID={`${testID}-soon`}>
          <Text style={styles.soonText}>Soon</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  item: {
    minHeight: sidebar.itemHeight,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  railItem: {
    width: sidebar.railItemSize,
    height: sidebar.railItemSize,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  resting: {
    backgroundColor: sidebar.colors.item,
  },
  restingPressed: {
    backgroundColor: sidebar.colors.itemPressed,
  },
  active: {
    backgroundColor: sidebar.colors.active,
  },
  activePressed: {
    backgroundColor: sidebar.colors.activePressed,
  },
  label: {
    ...typography.navItem,
    flex: 1,
  },
  labelActive: {
    ...typography.navItemActive,
    flex: 1,
  },
  soonTag: {
    borderRadius: radius.pill,
    backgroundColor: sidebar.colors.soonTag,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  soonText: {
    ...typography.captionStrong,
    color: sidebar.colors.soonText,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
