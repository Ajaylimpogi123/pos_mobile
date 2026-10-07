import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SidebarItem } from '@/components/shell/SidebarItem';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { ModuleDefinition, ModuleGroup, ModuleKey } from '@/constants/modules';
import { hitTarget, iconSizes, pressedScale, radius, sidebar, sizes, spacing, typography } from '@/constants/theme';
import type { AuthUser } from '@/services/types';

export type SidebarChevron = {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
};

type SidebarProps = {
  /** `expanded`: labelled rows. `rail`: icon-only buttons. */
  variant: 'expanded' | 'rail';
  groups: readonly ModuleGroup[];
  activeKey: ModuleKey;
  user: AuthUser;
  onSelect: (module: ModuleDefinition) => void;
  /** The small round chevron near the top (collapse / expand / close). */
  chevron: SidebarChevron | null;
  /** Opens the PIN quick-switch (another staff member takes over this device). */
  onSwitchUser: () => void;
  onLogout: () => void;
  /** Short heights: a smaller logo mark. */
  compact?: boolean;
  testID?: string;
};

/** "Mia Manager" → "MM". */
function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return letters.join('') || '?';
}

function Chevron({ chevron }: { chevron: SidebarChevron }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chevron.accessibilityLabel}
      onPress={chevron.onPress}
      hitSlop={sidebar.chevronHitSlop}
      testID="sidebar-chevron"
      style={({ pressed }) => [
        styles.chevron,
        { backgroundColor: pressed ? sidebar.colors.chevronPressed : sidebar.colors.chevron },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={chevron.icon} size={iconSizes.sm} color={sidebar.colors.text} />
    </Pressable>
  );
}

type FooterActionProps = {
  icon: IconName;
  label: string;
  hint?: string;
  rail: boolean;
  onPress: () => void;
  testID: string;
};

function FooterAction({ icon, label, hint, rail, onPress, testID }: FooterActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        rail ? styles.footerRound : styles.footerAction,
        { backgroundColor: pressed ? sidebar.colors.footerActionPressed : sidebar.colors.footerAction },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={iconSizes.md} color={sidebar.colors.itemText} />
      {rail ? null : (
        <Text style={styles.footerText} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The app-shell sidebar panel (Sidebar board): flat and white with a hairline
 * right border, the brand block on top (emerald logo tile, name, branch), a
 * small round chevron, the permitted modules under uppercase group labels
 * (Main, Catalogue, People, Insights, System), and the user block at the
 * bottom (avatar, name, role, Switch user, Log out). The active module is a
 * soft-green pill. The rail centres icon-only buttons with dividers between
 * groups. Everything scrolls on short heights (e.g. phone landscape).
 */
export function Sidebar({
  variant,
  groups,
  activeKey,
  user,
  onSelect,
  chevron,
  onSwitchUser,
  onLogout,
  compact = false,
  testID = 'sidebar',
}: SidebarProps) {
  const rail = variant === 'rail';
  const logoSize = compact || rail ? sidebar.logoSizeCompact : sidebar.logoSize;

  return (
    <View style={styles.panel} testID={testID}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, rail && styles.contentRail]}
        showsVerticalScrollIndicator={false}
        accessibilityRole="menu"
        accessibilityLabel="Navigation"
      >
        <View style={[styles.brand, rail && styles.brandRail]}>
          <View
            style={[styles.logo, { width: logoSize, height: logoSize }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Restaurant POS"
            testID={`${testID}-logo`}
          >
            <Icon name="leaf-outline" size={iconSizes.md} color={sidebar.colors.logoText} />
          </View>
          {rail ? null : (
            <View style={styles.brandText}>
              <Text style={styles.brandTitle} numberOfLines={1}>
                Restaurant POS
              </Text>
              <Text style={styles.brandSubtitle} numberOfLines={1}>
                {user.branch.name}
              </Text>
            </View>
          )}
          {chevron ? <Chevron chevron={chevron} /> : null}
        </View>

        {groups.map((group, index) => (
          <Fragment key={group.key}>
            {rail && index > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.group} testID={`sidebar-group-${group.key}`}>
              {rail ? null : (
                <Text style={styles.groupLabel} accessibilityRole="header">
                  {group.label}
                </Text>
              )}
              {group.modules.map((module) => (
                <SidebarItem
                  key={module.key}
                  module={module}
                  active={module.key === activeKey}
                  variant={variant}
                  onPress={onSelect}
                />
              ))}
            </View>
          </Fragment>
        ))}

        <View style={[styles.footer, rail && styles.footerRail]} testID="sidebar-footer">
          {rail ? (
            <View style={styles.avatar} accessible accessibilityLabel={`${user.name}, ${user.role.name}`} testID="sidebar-user">
              <Text style={styles.avatarText}>{initialsOf(user.name)}</Text>
            </View>
          ) : (
            <View style={styles.user} testID="sidebar-user">
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(user.name)}</Text>
              </View>
              <View style={styles.userText}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user.name}
                </Text>
                <View style={styles.roleRow} testID="sidebar-role">
                  <Icon name="shield-checkmark-outline" size={iconSizes.sm} color={sidebar.colors.textMuted} />
                  <Text style={styles.roleText} numberOfLines={1}>
                    {user.role.name}
                  </Text>
                </View>
              </View>
            </View>
          )}
          <FooterAction
            icon="people-circle-outline"
            label="Switch user"
            hint="Another staff member signs in on this device with their PIN"
            rail={rail}
            onPress={onSwitchUser}
            testID="sidebar-switch-user"
          />
          <FooterAction icon="log-out-outline" label="Log out" rail={rail} onPress={onLogout} testID="sidebar-logout" />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: sidebar.colors.panel,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: sidebar.panelPadding,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  contentRail: {
    alignItems: 'stretch',
    paddingHorizontal: sidebar.railPadding,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sidebar.brandHeight,
    marginBottom: spacing.xs,
  },
  brandRail: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  logo: {
    borderRadius: radius.md,
    backgroundColor: sidebar.colors.logo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    ...typography.brandSmall,
    color: sidebar.colors.text,
  },
  brandSubtitle: {
    ...typography.captionMedium,
    color: sidebar.colors.textMuted,
  },
  chevron: {
    width: sidebar.chevronSize,
    height: sidebar.chevronSize,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  group: {
    gap: spacing.xxs,
  },
  groupLabel: {
    ...typography.overline,
    color: sidebar.colors.groupLabel,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  divider: {
    height: sizes.borderWidth,
    backgroundColor: sidebar.colors.divider,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.sm,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: spacing.md,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: sidebar.colors.divider,
    gap: spacing.xxs,
  },
  footerRail: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  userText: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    ...typography.label,
    color: sidebar.colors.text,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  roleText: {
    ...typography.captionStrong,
    color: sidebar.colors.textMuted,
    flexShrink: 1,
  },
  avatar: {
    width: sidebar.avatarSize,
    height: sidebar.avatarSize,
    borderRadius: radius.pill,
    backgroundColor: sidebar.colors.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.label,
    color: sidebar.colors.avatarText,
  },
  footerAction: {
    minHeight: hitTarget.min,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  footerRound: {
    width: sidebar.railItemSize,
    height: sidebar.railItemSize,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    ...typography.navItem,
    color: sidebar.colors.itemText,
    flexShrink: 1,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
});
