/** Whether a CSS media query matches, kept in sync with the window (one source for layout breakpoints). */
import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * MASTER §6 Detail views: read-mostly details (orders, shifts, devices, errors)
 * open as a right sheet at ≥ 1280 px and as a full page below that.
 */
export function useDetailMode(): 'sheet' | 'page' {
  return useMediaQuery('(min-width: 1280px)') ? 'sheet' : 'page';
}
