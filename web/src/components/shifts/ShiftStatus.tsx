/** Shift status and flag badges (MASTER §1.3: dot + word on the status tint), with the tablet's wording. */
import { StatusBadge } from '@/components/ui/badge';
import type { ShiftStatus } from '@/services/types';

const FLAG_LABELS: Record<string, string> = {
  auto_closed: 'Closed automatically',
  movement_after_close: 'Cash moved after close',
};

/** A flag this build doesn't know is shown as it is (the contract types `flags` as `string[]`). */
// eslint-disable-next-line react-refresh/only-export-components
export function shiftFlagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag;
}

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return status === 'open' ? <StatusBadge tone="success" label="Open" /> : <StatusBadge tone="info" label="Closed" />;
}

export function ShiftFlagBadges({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((flag) => (
        <StatusBadge key={flag} tone="warning" label={shiftFlagLabel(flag)} />
      ))}
    </>
  );
}
