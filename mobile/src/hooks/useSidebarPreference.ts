import { useCallback, useEffect, useState } from 'react';

import { getSidebarCollapsed, saveSidebarCollapsed } from '@/services/secureStorage';

/**
 * The user's collapsed / expanded choice for the persistent sidebar (tablet
 * landscape), remembered per device. Starts expanded (the default) and
 * switches to the stored value once it has been read; a storage failure just
 * keeps the default.
 */
export function useSidebarPreference() {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSidebarCollapsed().then((stored) => {
      if (!cancelled && stored !== null) setCollapsedState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    void saveSidebarCollapsed(next);
  }, []);

  return { collapsed, setCollapsed };
}
