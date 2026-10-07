import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { colors, iconSizes } from '@/constants/theme';

/** Any Ionicons glyph name. */
export type IconName = ComponentProps<typeof Ionicons>['name'];

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  testID?: string;
};

/**
 * The app's only icon component (Ionicons from @expo/vector-icons).
 * Decorative by default: hidden from screen readers, because the pressable
 * or text around it carries the accessible label.
 */
export function Icon({ name, size = iconSizes.md, color = colors.text, testID }: IconProps) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
