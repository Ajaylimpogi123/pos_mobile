import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, radius, sizes } from '@/constants/theme';

export type IconBadgeTone = 'primary' | 'danger' | 'info';

type IconBadgeProps = {
  icon: IconName;
  tone?: IconBadgeTone;
  size?: 'md' | 'lg';
};

const palettes = {
  primary: { background: colors.primarySoft, icon: colors.primary },
  danger: { background: colors.dangerSoft, icon: colors.danger },
  info: { background: colors.infoSoft, icon: colors.info },
} as const;

/** Decorative round icon badge used at the top of cards, dialogs and states. */
export function IconBadge({ icon, tone = 'primary', size = 'md' }: IconBadgeProps) {
  const palette = palettes[tone];
  const dimension = sizes.badge[size];

  return (
    <View style={[styles.badge, { width: dimension, height: dimension, backgroundColor: palette.background }]}>
      <Icon name={icon} size={size === 'lg' ? iconSizes.xl : iconSizes.md} color={palette.icon} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
