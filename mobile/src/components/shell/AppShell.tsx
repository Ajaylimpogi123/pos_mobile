import { router } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NavOverlay } from '@/components/shell/NavOverlay';
import { ShellContext, type ShellContextValue } from '@/components/shell/ShellContext';
import { Sidebar } from '@/components/shell/Sidebar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ROUTES } from '@/constants/routes';
import { colors, sidebar } from '@/constants/theme';
import { useAppShell } from '@/hooks/useAppShell';
import { useLogout } from '@/hooks/useLogout';

type AppShellProps = {
  /** The content area (the signed-in Stack). */
  children: ReactNode;
};

/**
 * The signed-in app shell: the sidebar beside the content.
 * - The sidebar is a flat white panel flush with the left edge (a hairline
 *   border separates it from the content). It covers the left, top and bottom
 *   safe-area insets; the content
 *   screens pad the rest themselves (SafeAreaView only pads where a view
 *   actually overlaps an inset).
 * - The content keeps the same position in the tree in every mode (the
 *   sidebar slot is `null` when hidden), so a rotation re-lays out in place:
 *   no remount, no lost screen state or scroll position.
 * - Logout (from the sidebar footer) keeps its confirmation step.
 * - "Switch user" (sidebar footer) opens the PIN quick-switch screen.
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
  let sidebarWidth = 0;
  if (persistent) sidebarWidth = frame.paddingLeft + (persistent === 'expanded' ? sidebar.widthExpanded : sidebar.widthRail);

  const context = useMemo<ShellContextValue>(
    () => ({
      navigation: persistent ? 'persistent' : 'drawer',
      openNavigation: shell.openOverlay,
      sidebarExpanded: persistent === 'expanded',
      sidebarWidth,
    }),
    [persistent, shell.openOverlay, sidebarWidth],
  );
  const overlayPanelWidth = Math.min(sidebar.drawerMaxWidth, responsive.width * sidebar.drawerMaxShare);
  const overlayWidth = overlayPanelWidth + insets.left;

  function requestLogout() {
    shell.closeOverlay();
    logout.requestLogout();
  }

  function openSwitchUser() {
    shell.closeOverlay();
    router.push(ROUTES.switchUser);
  }

  return (
    <ShellContext.Provider value={context}>
      <View style={styles.root} testID="app-shell">
        {persistent && user ? (
          <View
            style={[
              styles.persistent,
              frame,
              { width: frame.paddingLeft + (persistent === 'expanded' ? sidebar.widthExpanded : sidebar.widthRail) },
            ]}
            testID={`sidebar-${persistent}`}
          >
            <Sidebar
              variant={persistent}
              groups={shell.groups}
              activeKey={shell.activeKey}
              user={user}
              onSelect={shell.selectModule}
              compact={responsive.isCompactHeight}
              chevron={
                persistent === 'expanded'
                  ? { icon: 'chevron-back', accessibilityLabel: 'Collapse sidebar', onPress: shell.toggleSidebar }
                  : { icon: 'chevron-forward', accessibilityLabel: 'Expand sidebar', onPress: shell.toggleSidebar }
              }
              onSwitchUser={openSwitchUser}
              onLogout={requestLogout}
            />
          </View>
        ) : null}

        <View style={styles.content} testID="app-content">
          {children}
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
                compact={responsive.isCompactHeight}
                chevron={{
                  icon: shell.overlayKind === 'drawer' ? 'close' : 'chevron-back',
                  accessibilityLabel: 'Close navigation',
                  onPress: shell.closeOverlay,
                }}
                onSwitchUser={openSwitchUser}
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
    backgroundColor: colors.background,
  },
  persistent: {
    backgroundColor: sidebar.colors.panel,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: sidebar.colors.border,
  },
  content: {
    flex: 1,
  },
  overlayFrame: {
    flex: 1,
    backgroundColor: sidebar.colors.panel,
    borderTopRightRadius: sidebar.panelRadius,
    borderBottomRightRadius: sidebar.panelRadius,
    overflow: 'hidden',
  },
});
