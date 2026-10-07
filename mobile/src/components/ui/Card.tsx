import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows, sizes } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Drop the default inner padding (e.g. for full-bleed content). */
  flush?: boolean;
  elevation?: 'sm' | 'md' | 'lg';
  testID?: string;
};

/** White surface: 16 px radius, a hairline border and a very soft shadow. Padding follows `useResponsive().cardPadding`. */
export function Card({ children, style, flush = false, elevation = 'sm', testID }: CardProps) {
  const { cardPadding } = useResponsive();

  return (
    <View style={[styles.card, shadows[elevation], !flush && { padding: cardPadding }, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
  },
});
