/** The wall clock, refreshed every `everyMs` (elapsed times on the table cards, reservation actions). */
import { useEffect, useState } from 'react';

export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
