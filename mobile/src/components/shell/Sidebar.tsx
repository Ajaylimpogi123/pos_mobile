import { Fragment } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import logo from '@/assets/images/logo.png';
import { SidebarItem } from '@/components/shell/SidebarItem';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { ModuleDefinition, ModuleGroup, ModuleKey } from '@/constants/modules';
import { colors, hitTarget, iconSizes, pressedScale, radius, sidebar, sizes, spacing, typography } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { AuthUser } from '@/services/types';

/** The restaurant's name beside / under the logo. */
export const BRAND_NAME = "Mama Bing's";

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
  onLogout: () => void;
  /** The dark **New sale** button under the logo (icon-only in the rail). Omit to hide it. */
  onNewSale?: () => void;
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
  const reduceMotion = useReducedMotion();
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
        pressed && !reduceMotion && styles.pressed,
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
  const reduceMotion = useReducedMotion();
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
        pressed && !reduceMotion && styles.pressed,
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

/** The dark neutral **New sale** button (MASTER §3 dark button): icon-only in the rail. */
function NewSaleButton({ rail, onPress }: { rail: boolean; onPress: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New sale"
      onPress={onPress}
      testID="sidebar-new-sale"
      style={({ pressed }) => [
        rail ? styles.newSaleRail : styles.newSale,
        { backgroundColor: pressed ? colors.darkPressed : colors.dark },
        pressed && !reduceMotion && styles.pressed,
      ]}
    >
      <Icon name="add" size={iconSizes.md} color={colors.onDark} />
      {rail ? null : (
        <Text style={styles.newSaleText} numberOfLines={1}>
          New sale
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The app-shell sidebar (MASTER §2.1 / §2.2 / §6), on the `sidebar` background:
 * - the round Mama Bing's logo (64 in the panel, 40 in the rail) and a small
 *   round chevron (open / close the labelled panel);
 * - the dark **New sale** button (icon-only in the rail);
 * - the permitted modules in the §6 groups (the first group has no heading),
 *   the active one on the `accent` fill; the rail shows icon-only 48 dp
 *   buttons (each with its label for screen readers) and dividers between groups;
 * - the user tile (avatar, name, role) and Log out at the bottom.
 * Everything scrolls on short heights (e.g. phone landscape).
 */
export function Sidebar({
  variant,
  groups,
  activeKey,
  user,
  onSelect,
  chevron,
  onLogout,
  onNewSale,
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
          <Image
            source={logo}
            style={[styles.logo, { width: logoSize, height: logoSize }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={BRAND_NAME}
            testID={`${testID}-logo`}
          />
          {rail ? null : (
            <View style={styles.brandText}>
              <Text style={styles.brandTitle} numberOfLines={1}>
                {BRAND_NAME}
              </Text>
              <Text style={styles.brandSubtitle} numberOfLines={1}>
                {user.branch.name}
              </Text>
            </View>
          )}
          {chevron ? <Chevron chevron={chevron} /> : null}
        </View>
        {onNewSale ? <NewSaleButton rail={rail} onPress={onNewSale} /> : null}

        {groups.map((group, index) => (
          <Fragment key={group.key}>
            {rail && index > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.group} testID={`sidebar-group-${group.key}`}>
              {rail || group.label === '' ? null : (
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
    borderRadius: radius.pill,
  },
  newSale: {
    minHeight: hitTarget.min,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  newSaleRail: {
    width: sidebar.railItemSize,
    height: sidebar.railItemSize,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  newSaleText: {
    ...typography.label,
    color: colors.onDark,
    flexShrink: 1,
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
