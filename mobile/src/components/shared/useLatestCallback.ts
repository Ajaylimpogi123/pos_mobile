import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but that always calls the latest
 * `fn`. List screens pass it to memoized cards (`React.memo`), so a card only
 * re-renders when its own data changes, not whenever the parent re-renders
 * with a fresh handler (e.g. one returned by a screen hook).
 *
 * Only call the returned function from event handlers, never during render.
 */
export function useLatestCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
