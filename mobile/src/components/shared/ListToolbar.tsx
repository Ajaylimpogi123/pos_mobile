import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, shadows, sizes, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type ListToolbarProps = {
  children: ReactNode;
  testID?: string;
};

/**
 * A list page's filters (search, status tabs, date bar) in a white card that
 * sits over the header band (back-office.md: the table card holds the tabs and
 * the search), so dark text never lands on the band. Its contents keep their
 * own horizontal padding.
 */
export function ListToolbar({ children, testID }: ListToolbarProps) {
  const { screenPaddingX, contentMaxWidth } = useResponsive();
  return (
    <View style={[styles.card, { marginHorizontal: screenPaddingX, maxWidth: contentMaxWidth }]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
});
