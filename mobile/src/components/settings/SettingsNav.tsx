import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { IconName } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';

export type SettingsNavKey = 'receipt' | 'printers' | 'dine_in' | 'tables' | 'staff' | 'customers' | 'logout';

export type SettingsNavEntry = {
  key: SettingsNavKey;
  label: string;
  icon: IconName;
  /** Read by screen readers, e.g. "Opens the Staff list". */
  hint: string;
  /** Sign out: red label and icon tile. */
  danger?: boolean;
};

export type SettingsNavGroup = {
  key: string;
  label: string;
  entries: readonly SettingsNavEntry[];
};

type RowProps = {
  entry: SettingsNavEntry;
  /** The section shown in the detail pane (tablets). */
  active: boolean;
  last: boolean;
  onSelect: (key: SettingsNavKey) => void;
};

/** A 56 dp settings row (`ListRow`): a soft icon tile, the label and a chevron; tinted when active, red for Sign out. */
const SettingsNavRow = memo(function SettingsNavRow({ entry, active, last, onSelect }: RowProps) {
  const { key } = entry;
  const handlePress = useCallback(() => onSelect(key), [onSelect, key]);
  return (
    <ListRow
      label={entry.label}
      icon={entry.icon}
      onPress={handlePress}
      accessibilityHint={entry.hint}
      selected={active}
      danger={entry.danger}
      chevron={!entry.danger}
      divider={!last}
      testID={`settings-nav-${entry.key}`}
    />
  );
});

type SettingsNavProps = {
  groups: readonly SettingsNavGroup[];
  /** The section in the detail pane (tablets), or `null` (phones: every row pushes a screen). */
  activeKey: SettingsNavKey | null;
  /** Stable: the rows are memoized. */
  onSelect: (key: SettingsNavKey) => void;
};

/**
 * The Settings navigation (Settings mock): grouped white cards under
 * uppercase group labels, one 56 dp row per section.
 */
export function SettingsNav({ groups, activeKey, onSelect }: SettingsNavProps) {
  return (
    <View style={styles.groups} testID="settings-nav">
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={styles.groupLabel} accessibilityRole="header">
            {group.label}
          </Text>
          <View style={styles.card}>
            {group.entries.map((entry, index) => (
              <SettingsNavRow
                key={entry.key}
                entry={entry}
                active={entry.key === activeKey}
                last={index === group.entries.length - 1}
                onSelect={onSelect}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  groups: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  groupLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
