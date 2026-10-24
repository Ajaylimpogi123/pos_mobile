import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeaderSyncStatus } from '@/components/shell/HeaderSyncStatus';
import { useShell } from '@/components/shell/ShellContext';
import { colors, layout, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type TopBarProps = {
  title: string;
  /**
   * A short line beside the title's meaning (e.g. "Your sales"). Shown under
   * the title, inside the same bar, only when there is room (tablets, not on
   * short landscape heights).
   */
  subtitle?: string | null;
  /** Left-hand accessory: the ☰ menu button (drawer mode) and / or a round back button. */
  left?: ReactNode;
  /** Right-hand accessory: compact icon actions or status chips. It shrinks before the title does. */
  right?: ReactNode;
  /**
   * Toolbar content (e.g. section tabs or chips). Rendered just below the bar,
   * on the page background, never inside the bar.
   */
  children?: ReactNode;
  /**
   * The sync badge (MASTER §2.2) on the right. Default: shown inside the app
   * shell. Pass `false` where the screen shows its own sync status (Sell).
   */
  sync?: boolean;
  /** Test IDs: `<id>` (root), `<id>-bar`, `<id>-title`, `<id>-subtitle`, `<id>-toolbar`. */
  testID?: string;
};

/**
 * The header of every content screen (MASTER §2.1 / §2.2 / §6): 48 dp high on
 * tablets and 56 on phones (plus the top safe area), on the inset panel with a
 * hairline bottom border. One row, never two: [left] | title (16 / 500, one
 * line, ellipsis) [right] [sync badge]. A vertical separator follows the
 * left-hand buttons. The sync state is always visible inside the app shell. It pads the
 * top, left and right safe-area edges itself, and its content is capped at
 * `contentMaxWidth` so it lines up with the grid below. Optional toolbar
 * content sits just under the bar.
 */
export function TopBar({ title, subtitle, left, right, sync = true, children, testID }: TopBarProps) {
  const { screenPaddingX, headerPaddingY, contentMaxWidth, topBarHeight, showBarSubtitle, isTablet, isCompactHeight } =
    useResponsive();
  const { navigation } = useShell();
  const showSubtitle = Boolean(subtitle) && showBarSubtitle;
  const large = isTablet && !isCompactHeight;
  const showSync = sync && navigation !== 'none';

  return (
    <View testID={testID}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.bar}>
        <View
          style={[styles.row, { minHeight: topBarHeight, maxWidth: contentMaxWidth, paddingHorizontal: screenPaddingX }]}
          testID={testID ? `${testID}-bar` : undefined}
        >
          {left ? (
            <>
              <View style={styles.left}>{left}</View>
              <View style={styles.separator} />
            </>
          ) : null}
          <View style={styles.text}>
            <Text
              style={[styles.title, large ? typography.barTitleLarge : typography.barTitle]}
              numberOfLines={1}
              accessibilityRole="header"
              testID={testID ? `${testID}-title` : undefined}
            >
              {title}
            </Text>
            {showSubtitle ? (
              <Text style={styles.subtitle} numberOfLines={1} testID={testID ? `${testID}-subtitle` : undefined}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right || showSync ? (
            <View style={styles.right}>
              {right}
              {showSync ? <HeaderSyncStatus /> : null}
            </View>
          ) : null}
        </View>
      </SafeAreaView>
      {children ? (
        <SafeAreaView edges={['left', 'right']}>
          <View
            style={[styles.toolbar, { maxWidth: contentMaxWidth, paddingHorizontal: screenPaddingX, paddingTop: headerPaddingY }]}
            testID={testID ? `${testID}-toolbar` : undefined}
          >
            {children}
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.none,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  separator: {
    width: sizes.borderWidth,
    height: sizes.headerSeparator,
    backgroundColor: colors.border,
  },
  text: {
    flex: 1,
    minWidth: layout.barTitleMinWidth,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.sm,
  },
  toolbar: {
    width: '100%',
    alignSelf: 'center',
    gap: spacing.sm,
    minHeight: sizes.chipMinHeight,
  },
});
