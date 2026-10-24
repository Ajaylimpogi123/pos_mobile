import { useNow } from '@/hooks/useNow';
import { useSessionStore } from '@/stores/session';
import { formatBusinessDate } from '@/utils/dates';
import { businessDateAt } from '@pos/core/businessDay';

/** The business date can roll over while a screen is open: check once a minute. */
const REFRESH_MS = 60_000;

/**
 * The band subtitle of list pages (back-office.md, MASTER §6): the branch and
 * the business date, e.g. "Main branch · Mon, 13 Oct 2026". The business date
 * follows the branch's time zone and day start. `null` when signed out.
 */
export function useBranchLine(): string | null {
  const branch = useSessionStore((state) => state.user?.branch ?? null);
  const now = useNow(REFRESH_MS);
  if (!branch) return null;
  const date = businessDateAt(now, branch.timezone, branch.day_start_time);
  return `${branch.name} · ${formatBusinessDate(date)}`;
}
