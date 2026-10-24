/**
 * The Reports date range (business days of the signed-in user's branch): a
 * preset, or From / To picked on a date input. Shared by every report, so
 * switching reports keeps it. The contract's rules are applied before a
 * request is sent: `to ≥ from`, at most 366 days (inclusive), never past today.
 */
import { useState } from 'react';

import { useSessionStore } from '@/stores/session';
import { addBusinessDays, businessDateAt, businessDaysBetween, firstOfMonth } from '@pos/core/businessDay';

/** Contract (Q-013): a report covers at most 366 days, counted inclusively. */
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

/** Keeps a range valid: the edge that just moved wins and the other one follows it. */
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function useReportRange() {
  const branch = useSessionStore((state) => state.user?.branch ?? null);
  const [today] = useState(() => (branch ? businessDateAt(Date.now(), branch.timezone, branch.day_start_time) : null));
  const [preset, setPreset] = useState<RangePreset>('last7');
  const [custom, setCustom] = useState<DateRange | null>(null);

  let range: DateRange | null = null;
  if (today) range = preset === 'custom' && custom ? custom : presetRange(preset === 'custom' ? 'last7' : preset, today);

  function setEdge(edge: 'from' | 'to', value: string) {
    if (!range || !today || !YMD.test(value)) return;
    setCustom(clampRange({ ...range, [edge]: value }, today, edge));
    setPreset('custom');
  }

  const span = range ? businessDaysBetween(range.from, range.to) : null;

  return {
    today,
    range,
    preset,
    choosePreset: (next: Exclude<RangePreset, 'custom'>) => {
      setPreset(next);
      setCustom(null);
    },
    setFrom: (value: string) => setEdge('from', value),
    setTo: (value: string) => setEdge('to', value),
    /** The number of days in the range (inclusive). */
    dayCount: span === null ? 0 : span + 1,
  };
}

export type ReportRangeState = ReturnType<typeof useReportRange>;
