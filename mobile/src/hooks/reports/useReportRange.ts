import { useState } from 'react';

import { useNow } from '@/hooks/useNow';
import { useSessionStore } from '@/stores/session';
import { addBusinessDays, businessDateAt, businessDaysBetween, firstOfMonth } from '@/utils/businessDay';

/** Contract: a report covers at most 366 days (inclusive range of 366 dates means 365 days apart). */
export const MAX_RANGE_DAYS = 366;

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'last30' | 'custom';

export const RANGE_PRESETS: readonly { key: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'last30', label: 'Last 30 days' },
];

export type DateRange = { from: string; to: string };

/** The range of a preset, ending today (business days). */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addBusinessDays(today, -1);
      return { from: day, to: day };
    }
    case 'last7':
      return { from: addBusinessDays(today, -6), to: today };
    case 'thisMonth':
      return { from: firstOfMonth(today), to: today };
    case 'last30':
      return { from: addBusinessDays(today, -29), to: today };
  }
}

/**
 * Keeps a range valid before it is sent (the contract's rules): `to ≥ from`,
 * at most 366 days, and never past today. The edge that just moved wins; the
 * other one follows it.
 */
export function clampRange(range: DateRange, today: string, moved: 'from' | 'to'): DateRange {
  let { from, to } = range;
  if (from > today) from = today;
  if (to > today) to = today;
  if (from > to) {
    if (moved === 'from') to = from;
    else from = to;
  }
  const span = businessDaysBetween(from, to);
  if (span !== null && span > MAX_RANGE_DAYS - 1) {
    if (moved === 'from') to = addBusinessDays(from, MAX_RANGE_DAYS - 1);
    else from = addBusinessDays(to, -(MAX_RANGE_DAYS - 1));
  }
  return { from, to };
}

const TODAY_REFRESH_MS = 60_000;

/**
 * The Reports screen's date range (business days): a preset, or From / To a
 * day at a time on either end. Shared by the Sales and Inventory views, so
 * switching keeps the range. `onChange` runs after every change (e.g. to
 * clear an export message).
 */
export function useReportRange(onChange?: () => void) {
  const branch = useSessionStore((state) => state.user?.branch ?? null);
  const now = useNow(TODAY_REFRESH_MS);
  const today = branch ? businessDateAt(now, branch.timezone, branch.day_start_time) : null;

  const [preset, setPreset] = useState<RangePreset>('last7');
  const [custom, setCustom] = useState<DateRange | null>(null);

  let range: DateRange | null = null;
  if (today) range = preset === 'custom' && custom ? custom : presetRange(preset === 'custom' ? 'last7' : preset, today);

  function move(edge: 'from' | 'to', days: number) {
    if (!range || !today) return;
    const next = { ...range, [edge]: addBusinessDays(range[edge], days) };
    setCustom(clampRange(next, today, edge));
    setPreset('custom');
    onChange?.();
  }

  const span = range ? businessDaysBetween(range.from, range.to) : null;

  return {
    today,
    range,
    preset,
    choosePreset: (next: Exclude<RangePreset, 'custom'>) => {
      setPreset(next);
      setCustom(null);
      onChange?.();
    },
    fromEarlier: () => move('from', -1),
    fromLater: () => move('from', 1),
    toEarlier: () => move('to', -1),
    toLater: () => move('to', 1),
    canMoveFromLater: range !== null && range.from < range.to,
    canMoveToLater: range !== null && today !== null && range.to < today,
    /** The number of days in the range (inclusive). */
    dayCount: span === null ? 0 : span + 1,
  };
}

export type ReportRangeState = ReturnType<typeof useReportRange>;
