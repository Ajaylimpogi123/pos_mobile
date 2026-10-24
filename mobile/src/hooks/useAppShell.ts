import { router, usePathname } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { useDineInEnabled } from '@/hooks/tables/useDineIn';
import { activeModuleKey, visibleModuleGroups, type ModuleDefinition } from '@/constants/modules';
import { useResponsive, type SidebarMode } from '@/hooks/useResponsive';
import { ROUTES } from '@/constants/routes';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * What the app shell shows, derived from `useResponsive().sidebarMode`
 * (MASTER §2.2 / §6):
 * - tablets (both orientations) / phone landscape: the persistent 64 dp rail;
 *   its chevron opens the 256 dp labelled panel as an overlay with a scrim
 * - phone portrait: no persistent sidebar; ☰ opens a slide-in drawer
 *
 * The overlay is tied to the size class it was opened in, so a rotation
 * closes it without an effect, and the content's state is never touched.
 */
export function useAppShell() {
  const responsive = useResponsive();
  const { sidebarMode } = responsive;
  const [overlayMode, setOverlayMode] = useState<SidebarMode | null>(null);
  const pathname = usePathname();
  const user = useSessionStore((state) => state.user);

  const dineIn = useDineInEnabled();
  const groups = useMemo(() => visibleModuleGroups(user, { dineIn }), [user, dineIn]);
  const activeKey = activeModuleKey(pathname ?? '/');

  const persistent: 'rail' | null = sidebarMode === 'rail' ? 'rail' : null;

  const overlayOpen = overlayMode !== null && overlayMode === sidebarMode;

  const openOverlay = useCallback(() => setOverlayMode(sidebarMode), [sidebarMode]);
  const closeOverlay = useCallback(() => setOverlayMode(null), []);

  /** The rail's chevron: opens the labelled panel as an overlay. */
  const toggleSidebar = openOverlay;

  const selectModule = useCallback(
    (module: ModuleDefinition) => {
      setOverlayMode(null);
      if (module.status !== 'ready' || !module.route) return;
      // Already on this module's root: nothing to do.
      if (module.key === activeKey && pathname === module.route) return;
      // `navigate` unwinds to the module if it is already on the content stack, else pushes it.
      router.navigate(module.route);
    },
    [activeKey, pathname],
  );

  /** The dark icon-only **New sale** button under the logo (MASTER §6): for users who can sell. */
  const canSell = hasPermission(user, PERMISSIONS.saleCreate);
  const newSale = useCallback(() => {
    setOverlayMode(null);
    if (pathname === ROUTES.sell) return;
    router.navigate(ROUTES.sell);
  }, [pathname]);

  return {
    responsive,
    canSell,
    newSale,
    user,
    groups,
    activeKey,
    persistent,
    /** `drawer` on phone portrait (no persistent sidebar), else `overlay` (over the rail). */
    overlayKind: sidebarMode === 'drawer' ? ('drawer' as const) : ('overlay' as const),
    overlayOpen,
    openOverlay,
    closeOverlay,
    toggleSidebar,
    selectModule,
  };
}
