import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MenuButton } from '@/components/shell/MenuButton';
import { Button } from '@/components/ui/Button';
import { HeaderBand } from '@/components/ui/HeaderBand';
import { IconButton } from '@/components/ui/IconButton';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES } from '@/constants/routes';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { useBranchLine } from '@/hooks/useBranchLine';
import { useResponsive } from '@/hooks/useResponsive';
import { goBackOr } from '@/utils/navigation';

type ListHeaderProps = {
  title: string;
  /** A short line under the title, shown only where there is room (tablets). With `band`, it leads the band subtitle. */
  subtitle?: string;
  /** Accessible label of the create action, e.g. "New staff". Omit `onNew` to hide the action. */
  newLabel?: string;
  onNew?: () => void;
  /**
   * A visible label for the create action, e.g. "New request". Tablets then
   * show a labelled primary button instead of the round "+" (phones keep the "+").
   * With `band`, the labelled green pill shows on every size.
   */
  newTitle?: string;
  /**
   * An inline search (e.g. a `ListSearch` with `variant="searchSurface"`), drawn in
   * the bar before the create action. Pass it only on tablets (a device class that
   * doesn't change on rotation), so the field keeps its tree position and focus.
   */
  search?: ReactNode;
  /**
   * The list-page band (back-office.md, MASTER §2.3 / §6): the decorative green
   * band under the header, carrying the page title (26 / 700, white), the
   * branch and business date (white), and the page actions on the right
   * (`bandActions` as outline buttons, then the create action as a green pill).
   * The content drawn after the header (the table card or the cards) overlaps
   * the band.
   */
  band?: boolean;
  /** Outline buttons on the band's right (e.g. a date picker, **Export CSV**). */
  bandActions?: ReactNode;
  /** Toolbar content just below the bar, e.g. section tabs. */
  children?: ReactNode;
  /** Prefix for the header's test IDs: `<id>-header`, `<id>-back`, `<id>-new`, `<id>-band…`. */
  testIDPrefix: string;
};

/**
 * Header for list screens: the 48 dp header (a back button to the dashboard,
 * the title, an optional inline search, the sync badge) and, by default, the
 * create action in it (a round green "+", or a labelled pill on tablets). On
 * phone portrait (no persistent sidebar) a ☰ button opens the navigation
 * drawer. With `band`, the title block and the actions move onto the band.
 */
export function ListHeader({
  title,
  subtitle,
  newLabel,
  onNew,
  newTitle,
  search,
  band = false,
  bandActions,
  children,
  testIDPrefix,
}: ListHeaderProps) {
  const { isTablet, screenPaddingX, bandCompact } = useResponsive();
  const branchLine = useBranchLine();

  let action: ReactNode = null;
  if (onNew && band) {
    action = (
      <Button
        title={newTitle ?? newLabel ?? 'Add'}
        leftIcon="add"
        accessibilityLabel={newLabel ?? newTitle ?? 'Add'}
        onPress={onNew}
        testID={`${testIDPrefix}-new`}
      />
    );
  } else if (onNew && newTitle && isTablet) {
    action = <Button title={newTitle} leftIcon="add" accessibilityLabel={newLabel ?? newTitle} onPress={onNew} testID={`${testIDPrefix}-new`} />;
  } else if (onNew) {
    action = (
      <IconButton icon="add" variant="accent" accessibilityLabel={newLabel ?? 'New'} onPress={onNew} testID={`${testIDPrefix}-new`} />
    );
  }

  const barAction = band ? null : action;
  // The band's subtitle: the page's own line (e.g. "Your sales"), then the branch and business date.
  const bandSubtitle = [subtitle, branchLine].filter(Boolean).join(' · ');

  return (
    <View>
      <TopBar
        title={title}
        subtitle={band ? null : subtitle}
        testID={`${testIDPrefix}-header`}
        left={
          <>
            <MenuButton testID={`${testIDPrefix}-open-navigation`} />
            <IconButton
              icon="arrow-back"
              variant="bar"
              accessibilityLabel="Back"
              onPress={() => goBackOr(ROUTES.home)}
              testID={`${testIDPrefix}-back`}
            />
          </>
        }
        right={
          search || barAction ? (
            <>
              {search ? <View style={styles.search}>{search}</View> : null}
              {barAction}
            </>
          ) : null
        }
      >
        {band ? null : children}
      </TopBar>
      {band ? (
        <View style={[styles.band, { paddingHorizontal: screenPaddingX }]} testID={`${testIDPrefix}-band`}>
          <HeaderBand style={styles.bandShape} testID={`${testIDPrefix}-band-gradient`} />
          <View style={styles.bandRow}>
            <View style={styles.bandText}>
              <Text
                style={[bandCompact ? typography.bandTitleCompact : typography.bandTitle, styles.onBand]}
                numberOfLines={1}
                accessibilityRole="header"
                testID={`${testIDPrefix}-band-title`}
              >
                {title}
              </Text>
              {bandSubtitle ? (
                <Text style={[typography.bandSubtitle, styles.onBand]} numberOfLines={1} testID={`${testIDPrefix}-band-subtitle`}>
                  {bandSubtitle}
                </Text>
              ) : null}
            </View>
            {bandActions || action ? (
              <View style={styles.bandActions}>
                {bandActions}
                {action}
              </View>
            ) : null}
          </View>
          {children ? <View style={styles.bandToolbar}>{children}</View> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    width: layout.headerSearchWidth,
    flexShrink: 1,
    minWidth: layout.headerSearchMinWidth,
  },
  band: {
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  /** The band sits inside the inset panel's padding so its 6 px corners show. */
  bandShape: {
    left: spacing.sm,
    right: spacing.sm,
    top: spacing.sm,
  },
  bandRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  /** MASTER §6: capped at half the band, so white text stays on its dark side. */
  bandText: {
    flexShrink: 1,
    maxWidth: `${layout.bandTextMaxShare * 100}%`,
    gap: spacing.xxs,
  },
  onBand: {
    color: colors.onGradient,
  },
  bandActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bandToolbar: {
    gap: spacing.sm,
  },
});
