/**
 * The dashboard band's period filter (api-contract "Dashboard Period Filter"
 * §D): a `Day · Month · Year` segmented control (a radio group: arrow keys
 * move and select, one tab stop) and a white `‹ label ›` stepper. `›` is
 * disabled on the current period, judged against the server's business date.
 * Controls are 36 px tall with a 44 px hit area (MASTER §6 Targets).
 */
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import {
  filterLabel,
  isCurrentPeriod,
  nextPeriod,
  PERIOD_OPTIONS,
  previousPeriod,
  stepLabel,
  type DashboardFilter,
} from '@/components/dashboard/dashboardPeriod';
import { cn } from '@/lib/utils';
import type { DashboardPeriod } from '@/services/types';

type DashboardPeriodFilterProps = {
  filter: DashboardFilter;
  /** The server's current business date (`T`), or the branch's own when not loaded yet. */
  today: string;
  onChange: (filter: DashboardFilter) => void;
};

/** An invisible 44 px hit area around a 36 px control. */
const HIT_AREA = "relative after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']";
/** The same for a 30 px segment inside the 36 px track. */
const SEGMENT_HIT_AREA = "relative after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']";

export function DashboardPeriodFilter({ filter, today, onChange }: DashboardPeriodFilterProps) {
  const current = isCurrentPeriod(filter, today);
  const label = filterLabel(filter, today);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sales period">
      <PeriodSegments value={filter.period} onChange={(period) => onChange({ period, anchor: filter.anchor })} />
      <div className="inline-flex h-9 items-center rounded-lg border border-border bg-card shadow-xs">
        <button
          type="button"
          aria-label={stepLabel(filter.period, -1)}
          disabled={today === '' && filter.anchor === null}
          onClick={() => onChange(previousPeriod(filter, today))}
          className={cn(
            HIT_AREA,
            'flex h-full w-11 items-center justify-center rounded-l-lg text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </button>
        <span aria-live="polite" className="min-w-36 border-x border-border px-3 text-center text-sm font-medium tabular whitespace-nowrap">
          {label}
        </span>
        <button
          type="button"
          aria-label={stepLabel(filter.period, 1)}
          disabled={current}
          onClick={() => onChange(nextPeriod(filter, today))}
          className={cn(
            HIT_AREA,
            'flex h-full w-11 items-center justify-center rounded-r-lg text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function PeriodSegments({ value, onChange }: { value: DashboardPeriod; onChange: (value: DashboardPeriod) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PERIOD_OPTIONS.length - 1;
    let target: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = index === 0 ? last : index - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = last;
    if (target === null) return;
    event.preventDefault();
    onChange(PERIOD_OPTIONS[target].value);
    refs.current[target]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Period" className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-track p-0.5">
      {PERIOD_OPTIONS.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              SEGMENT_HIT_AREA,
              'h-full min-w-14 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              checked ? 'bg-card text-foreground shadow-card' : 'hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
