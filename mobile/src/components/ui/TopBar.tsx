import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  /** Test IDs: `<id>` (root), `<id>-bar`, `<id>-title`, `<id>-subtitle`, `<id>-toolbar`. */
  testID?: string;
};

/**
 * The compact, flat top bar of every content screen: 56 dp high on phones and
 * 64 on tablets (plus the top safe area), flat white with a hairline bottom border.
 * One row, never two: [left] title (one line, ellipsis) [right]. It pads the
 * top, left and right safe-area edges itself, and its content is capped at
 * `contentMaxWidth` so it lines up with the grid below. Optional toolbar
 * content sits just under the bar.
 */
export function TopBar({ title, subtitle, left, right, children, testID }: TopBarProps) {
  const { screenPaddingX, headerPaddingY, contentMaxWidth, topBarHeight, showBarSubtitle, isTablet, isCompactHeight } =
    useResponsive();
  const showSubtitle = Boolean(subtitle) && showBarSubtitle;
  const large = isTablet && !isCompactHeight;

  return (
    <View testID={testID}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.bar}>
        <View
          style={[styles.row, { minHeight: topBarHeight, maxWidth: contentMaxWidth, paddingHorizontal: screenPaddingX }]}
          testID={testID ? `${testID}-bar` : undefined}
        >
          {left ? <View style={styles.left}>{left}</View> : null}
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
          {right ? <View style={styles.right}>{right}</View> : null}
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
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
