import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, hitTarget, opacity, pressedScale, spacing, typography } from '@/constants/theme';

type SectionHeaderProps = {
  title: string;
  /** Short muted text after the title, e.g. "12 items". */
  meta?: string;
  /** An optional text action on the right, e.g. "See all". */
  action?: { label: string; onPress: () => void; accessibilityHint?: string; testID?: string };
  testID?: string;
};

/**
 * A consistent section heading inside content: "Title · meta ··· Action".
 * The title is bold, the meta muted, the action a green text button with a
 * 44 dp touch target. Long titles truncate instead of pushing the action off.
 */
export function SectionHeader({ title, meta, action, testID }: SectionHeaderProps) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1} testID={testID ? `${testID}-meta` : undefined}>
            {meta}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.accessibilityHint}
          onPress={action.onPress}
          testID={action.testID}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText} numberOfLines={1}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.min,
  },
  text: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  title: {
    ...typography.section,
    color: colors.text,
    flexShrink: 1,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  action: {
    minHeight: hitTarget.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionPressed: {
    opacity: opacity.dimmed,
    transform: [{ scale: pressedScale }],
  },
  actionText: {
    ...typography.controlStrong,
    color: colors.primary,
  },
});
