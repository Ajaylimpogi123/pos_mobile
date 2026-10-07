import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, layout, spacing, typography } from '@/constants/theme';

type PaneHeaderProps = {
  title: string;
  description?: string | null;
  /** On the right (wraps under the text on narrow panes), e.g. "Add printer". */
  action?: ReactNode;
  testID?: string;
};

/** The heading of a detail pane (Settings on tablets): a bold title, a muted line and an optional action. */
export function PaneHeader({ title, description, action, testID }: PaneHeaderProps) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.text}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
    gap: spacing.xs,
  },
  title: {
    ...typography.paneTitle,
    color: colors.text,
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
