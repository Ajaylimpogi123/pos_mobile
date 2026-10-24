import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UpdateAvailableBanner } from '@/components/device/UpdateAvailableBanner';
import { NavOverlay } from '@/components/shell/NavOverlay';
import { ShellContext, type ShellContextValue } from '@/components/shell/ShellContext';
import { Sidebar } from '@/components/shell/Sidebar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colors, radius, shadows, sidebar } from '@/constants/theme';
import { useAppShell } from '@/hooks/useAppShell';
import { useLogout } from '@/hooks/useLogout';

type AppShellProps = {
  /** The content area (the signed-in Stack). */
  children: ReactNode;
};

/**
 * The signed-in app shell (MASTER §2.1 / §2.2 / §6): the 64 dp icon rail beside
 * the **inset panel**.
 * - The rail sits flush with the left edge on the `sidebar` background and
 *   covers the left, top and bottom safe-area insets. Its chevron opens the
 *   256 dp labelled panel as an overlay; a dark icon-only **New sale** button
 *   sits under the logo (users with `sale.create`).
 * - The content is the inset panel: an 8 dp margin, radius 12, the `inset`
 *   background and the inset shadow (full-bleed on phones in portrait, where
 *   there is no rail). Content screens pad the remaining safe-area edges
 *   themselves (SafeAreaView only pads where a view actually overlaps an inset).
 * - The content keeps the same position in the tree in every mode (the
 *   sidebar slot is `null` when hidden), so a rotation re-lays out in place:
 *   no remount, no lost screen state or scroll position.
 * - Logout (from the sidebar footer) keeps its confirmation step.
 */
export function AppShell({ children }: AppShellProps) {
  const shell = useAppShell();
  const logout = useLogout();
  const insets = useSafeAreaInsets();
  const { responsive, persistent, overlayOpen, user } = shell;

  const frame = {
    paddingLeft: insets.left + sidebar.outerMargin,
    paddingTop: insets.top + sidebar.outerMargin,
    paddingBottom: insets.bottom + sidebar.outerMargin,
  };
  const railWidth = frame.paddingLeft + sidebar.widthRail;
  // The inset panel's margin is part of what the content loses to the shell.
  const sidebarWidth = persistent ? railWidth + 2 * sidebar.insetMargin : 0;

  const context = useMemo<ShellContextValue>(
    () => ({
      navigation: persistent ? 'persistent' : 'drawer',
      openNavigation: shell.openOverlay,
      sidebarExpanded: false,
      sidebarWidth,
    }),
    [persistent, shell.openOverlay, sidebarWidth],
  );
  const overlayPanelWidth = Math.min(sidebar.drawerMaxWidth, responsive.width * sidebar.drawerMaxShare);
  const overlayWidth = overlayPanelWidth + insets.left;

  const newSale = shell.canSell ? shell.newSale : undefined;

  function requestLogout() {
    shell.closeOverlay();
    logout.requestLogout();
  }

  return (
    <ShellContext.Provider value={context}>
      <View style={styles.root} testID="app-shell">
        {persistent && user ? (
          <View
            style={[styles.persistent, frame, { width: railWidth }]}
            testID={`sidebar-${persistent}`}
          >
            <Sidebar
              variant="rail"
              groups={shell.groups}
              activeKey={shell.activeKey}
              user={user}
              onSelect={shell.selectModule}
              onNewSale={newSale}
              compact={responsive.isCompactHeight}
              chevron={{ icon: 'chevron-forward', accessibilityLabel: 'Expand sidebar', onPress: shell.toggleSidebar }}
              onLogout={requestLogout}
            />
          </View>
        ) : null}

        <View style={[styles.content, persistent ? styles.inset : styles.insetFlush]} testID="app-content">
          <UpdateAvailableBanner />
          <View style={styles.content}>{children}</View>
        </View>

        {user ? (
          <NavOverlay
            visible={overlayOpen}
            onClose={shell.closeOverlay}
            width={overlayWidth}
            testID={shell.overlayKind === 'drawer' ? 'nav-drawer' : 'nav-overlay'}
          >
            <View style={[styles.overlayFrame, frame]}>
              <Sidebar
                variant="expanded"
                groups={shell.groups}
                activeKey={shell.activeKey}
                user={user}
                onSelect={shell.selectModule}
                onNewSale={newSale}
                compact={responsive.isCompactHeight}
                chevron={{
                  icon: shell.overlayKind === 'drawer' ? 'close' : 'chevron-back',
                  accessibilityLabel: 'Close navigation',
                  onPress: shell.closeOverlay,
                }}
                onLogout={requestLogout}
                testID="sidebar-panel-overlay"
              />
            </View>
          </NavOverlay>
        ) : null}

        <ConfirmDialog
          visible={logout.confirmVisible}
          title="Log out?"
          message="You'll need your email and password to log back in."
          confirmLabel="Log out"
          confirmVariant="danger"
          icon="log-out-outline"
          busy={logout.signingOut}
          onConfirm={() => void logout.confirmLogout()}
          onCancel={logout.cancelLogout}
          testID="logout-dialog"
        />
      </View>
    </ShellContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.sidebar,
  },
  persistent: {
    backgroundColor: sidebar.colors.panel,
  },
  content: {
    flex: 1,
  },
  /** The inset panel (MASTER §2.1): 8 dp margin, radius 12, the inset background and shadow. */
  inset: {
    margin: sidebar.insetMargin,
    marginLeft: 0,
    borderRadius: radius.lg,
    backgroundColor: colors.inset,
    overflow: 'hidden',
    ...shadows.inset,
  },
  insetFlush: {
    backgroundColor: colors.inset,
  },
  overlayFrame: {
    flex: 1,
    backgroundColor: sidebar.colors.panel,
    borderTopRightRadius: sidebar.panelRadius,
    borderBottomRightRadius: sidebar.panelRadius,
    overflow: 'hidden',
  },
});
