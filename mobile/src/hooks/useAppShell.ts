import { router, usePathname } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { activeModuleKey, visibleModuleGroups, type ModuleDefinition } from '@/constants/modules';
import { useResponsive, type SidebarMode } from '@/hooks/useResponsive';
import { useSidebarPreference } from '@/hooks/useSidebarPreference';
import { useSessionStore } from '@/stores/session';

/**
 * What the app shell shows, derived from `useResponsive().sidebarMode` and the
 * remembered preference:
 * - tablet landscape: a persistent expanded panel, collapsible to the rail
 *   with the chevron (remembered per device)
 * - tablet portrait / phone landscape: a persistent rail; the chevron opens
 *   the expanded panel as an overlay with a scrim
 * - phone portrait: no persistent sidebar; ☰ opens a slide-in drawer
 *
 * The overlay is tied to the size class it was opened in, so a rotation
 * closes it without an effect, and the content's state is never touched.
 */
export function useAppShell() {
  const responsive = useResponsive();
  const { sidebarMode } = responsive;
  const { collapsed, setCollapsed } = useSidebarPreference();
  const [overlayMode, setOverlayMode] = useState<SidebarMode | null>(null);
  const pathname = usePathname();
  const user = useSessionStore((state) => state.user);

  const groups = useMemo(() => visibleModuleGroups(user), [user]);
  const activeKey = activeModuleKey(pathname ?? '/');

  let persistent: 'expanded' | 'rail' | null = null;
  if (sidebarMode === 'expanded') persistent = collapsed ? 'rail' : 'expanded';
  else if (sidebarMode === 'rail') persistent = 'rail';

  const overlayOpen = overlayMode !== null && overlayMode === sidebarMode;

  const openOverlay = useCallback(() => setOverlayMode(sidebarMode), [sidebarMode]);
  const closeOverlay = useCallback(() => setOverlayMode(null), []);

  /** The persistent panel's chevron: collapse / expand in place, or open the overlay from the rail. */
  const toggleSidebar = useCallback(() => {
    if (sidebarMode === 'expanded') setCollapsed(!collapsed);
    else openOverlay();
  }, [sidebarMode, collapsed, setCollapsed, openOverlay]);

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

  return {
    responsive,
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
