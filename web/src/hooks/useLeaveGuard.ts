/**
 * "Leaving with unsaved changes asks first" (Table Management §F, the floor
 * plan editor). The app uses `BrowserRouter`, which has no navigation
 * blocker, so while `active`:
 * - closing or reloading the browser tab shows the browser's own prompt
 *   (`beforeunload`);
 * - a click on an in-app link (the sidebar, a header link) is held back and
 *   `pending` is set; `leave()` replays the same click, `stay()` drops it;
 * - in-page moves (another tab of the page, another area) call `confirm(run)`,
 *   which runs at once when nothing is unsaved.
 */
import { useEffect, useRef, useState } from 'react';

export function useLeaveGuard(active: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (!active) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Older browsers need a value to show the prompt.
      event.returnValue = '';
    }

    function onClick(event: MouseEvent) {
      if (bypass.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target && target.target !== '_self') return;
      if (target.hasAttribute('download')) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => {
        bypass.current = true;
        try {
          target.click();
        } finally {
          bypass.current = false;
        }
      });
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  return {
    /** A move waiting for the user's answer. */
    pending: pending !== null,
    /** Runs `run` now, or after the user agrees to drop the unsaved changes. */
    confirm: (run: () => void) => {
      if (active) setPending(() => run);
      else run();
    },
    leave: () => {
      const run = pending;
      setPending(null);
      run?.();
    },
    stay: () => setPending(null),
  };
}
