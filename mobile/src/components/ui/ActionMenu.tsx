import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DialogFrame } from '@/components/ui/DialogFrame';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, radius, spacing, typography } from '@/constants/theme';

export type MenuAction = {
  key: string;
  label: string;
  icon: IconName;
  /** A destructive action (e.g. Void): drawn in the destructive colour. It still confirms in its own dialog. */
  destructive?: boolean;
  onPress: () => void;
};

type ActionMenuProps = {
  /** `null`: closed. */
  title: string | null;
  actions: readonly MenuAction[];
  onClose: () => void;
  testID?: string;
};

/**
 * The menu a row's ⋯ button opens (back-office.md: destructive actions sit in
 * the row menu and confirm in a dialog). A small dialog listing the actions as
 * 48 dp rows; choosing one closes the menu first. Test IDs: `<id>` and
 * `<id>-<key>`.
 */
export function ActionMenu({ title, actions, onClose, testID = 'action-menu' }: ActionMenuProps) {
  return (
    <DialogFrame visible={title !== null} onRequestClose={onClose} testID={testID}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.list}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            testID={`${testID}-${action.key}`}
          >
            <Icon name={action.icon} size={iconSizes.md} color={action.destructive ? colors.danger : colors.textResting} />
            <Text style={[styles.label, action.destructive && styles.destructive]}>{action.label}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID={`${testID}-close`}
        >
          <Icon name="close" size={iconSizes.md} color={colors.textSecondary} />
          <Text style={styles.cancel}>Close</Text>
        </Pressable>
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.heading,
    color: colors.text,
  },
  list: {
    gap: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.accent,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  destructive: {
    color: colors.danger,
  },
  cancel: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
