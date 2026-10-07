import { useEffect, useState } from 'react';

/** The current time (ms), refreshed every `intervalMs`, for relative labels like "5 min ago". */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
