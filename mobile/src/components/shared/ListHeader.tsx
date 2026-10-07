import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { MenuButton } from '@/components/shell/MenuButton';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES } from '@/constants/routes';
import { layout } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { goBackOr } from '@/utils/navigation';

type ListHeaderProps = {
  title: string;
  /** A short line under the title, shown only where there is room (tablets). */
  subtitle?: string;
  /** Accessible label of the create action, e.g. "New staff". Omit `onNew` to hide the action. */
  newLabel?: string;
  onNew?: () => void;
  /**
   * A visible label for the create action, e.g. "New request". Tablets then
   * show a labelled primary button instead of the round "+" (phones keep the "+").
   */
  newTitle?: string;
  /**
   * An inline search (e.g. a `ListSearch` with `variant="searchSurface"`), drawn in
   * the bar before the create action. Pass it only on tablets (a device class that
   * doesn't change on rotation), so the field keeps its tree position and focus.
   */
  search?: ReactNode;
  /** Toolbar content just below the bar, e.g. section tabs. */
  children?: ReactNode;
  /** Prefix for the header's test IDs: `<id>-header`, `<id>-back`, `<id>-new`. */
  testIDPrefix: string;
};

/**
 * Compact top bar for list screens: a round back button (to the dashboard),
 * the title, an optional inline search, and an optional create action (a round
 * deep-green "+", or a labelled button on tablets). On phone portrait (no
 * persistent sidebar) a ☰ button opens the navigation drawer.
 */
export function ListHeader({ title, subtitle, newLabel, onNew, newTitle, search, children, testIDPrefix }: ListHeaderProps) {
  const { isTablet } = useResponsive();

  let action: ReactNode = null;
  if (onNew && newTitle && isTablet) {
    action = <Button title={newTitle} leftIcon="add" accessibilityLabel={newLabel ?? newTitle} onPress={onNew} testID={`${testIDPrefix}-new`} />;
  } else if (onNew) {
    action = (
      <IconButton icon="add" variant="accent" accessibilityLabel={newLabel ?? 'New'} onPress={onNew} testID={`${testIDPrefix}-new`} />
    );
  }

  return (
    <TopBar
      title={title}
      subtitle={subtitle}
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
        search || action ? (
          <>
            {search ? <View style={styles.search}>{search}</View> : null}
            {action}
          </>
        ) : null
      }
    >
      {children}
    </TopBar>
  );
}

const styles = StyleSheet.create({
  search: {
    width: layout.headerSearchWidth,
    flexShrink: 1,
    minWidth: layout.headerSearchMinWidth,
  },
});
