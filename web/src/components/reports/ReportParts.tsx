/**
 * Pieces shared by the report views: the date range bar (presets plus From /
 * To, in the branch's business days), the totals grid, and the frame that
 * shows every state (loading, error with Retry, empty, a refresh that failed,
 * an export error, the 500-row cap).
 */
import { LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Banner } from '@/components/common/Banner';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_RANGE_DAYS, RANGE_PRESETS, type ReportRangeState } from '@/hooks/reports/useReportRange';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/services/api';
import { addBusinessDays } from '@pos/core/businessDay';

/** Contract: rows are capped at 500 (`meta.truncated`). */
const TRUNCATED_MESSAGE = 'Showing the first 500 rows. Choose a shorter range or more filters to see every row.';

/** "1 day" / "7 days". */
function dayCountLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** The presets (a pressed-button group) and the From / To date inputs. */
export function ReportRangeBar({ range, children }: { range: ReportRangeState; children?: ReactNode }) {
  const today = range.today ?? undefined;
  const earliest = range.range ? addBusinessDays(range.range.to, -(MAX_RANGE_DAYS - 1)) : undefined;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <span id="report-range-label" className="text-sm font-medium">
          Range
        </span>
        <div role="group" aria-labelledby="report-range-label" className="inline-flex flex-wrap gap-1 rounded-lg bg-track p-1">
          {RANGE_PRESETS.map((preset) => {
            const active = range.preset === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                onClick={() => range.choosePreset(preset.key)}
                className={cn(
                  'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium',
                  active ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-from">From</Label>
        <Input
          id="report-from"
          type="date"
          className="w-40 tabular"
          value={range.range?.from ?? ''}
          min={earliest}
          max={today}
          onChange={(event) => range.setFrom(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-to">To</Label>
        <Input
          id="report-to"
          type="date"
          className="w-40 tabular"
          value={range.range?.to ?? ''}
          min={range.range?.from}
          max={today}
          onChange={(event) => range.setTo(event.target.value)}
        />
      </div>
      <p className="pb-2 text-sm text-muted-foreground tabular" aria-live="polite">
        {dayCountLabel(range.dayCount)} · at most {MAX_RANGE_DAYS}
      </p>
      {children}
    </div>
  );
}

export type ReportTotal = { key: string; label: string; value: string; emphasis?: boolean; tone?: 'danger' };

/** The totals as small figure cards; the report's headline figure is emphasised in green. */
export function ReportTotals({ totals, label = 'Totals', note }: { totals: readonly ReportTotal[]; label?: string; note?: string }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {totals.map((total) => (
          <div
            key={total.key}
            className={cn('flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-card', total.emphasis && 'border-green-line bg-green-soft')}
          >
            <dt className="text-[13px] font-medium text-muted-foreground">{total.label}</dt>
            <dd className={cn('text-xl font-bold tabular', total.emphasis && 'text-green', total.tone === 'danger' && 'text-danger')}>{total.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="text-[13px] text-muted-foreground">{note}</p> : null}
    </section>
  );
}

type QueryLike = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

type ReportFrameProps = {
  query: QueryLike;
  hasData: boolean;
  /** No rows or figures to show for this query. */
  empty: { title: string; message: string } | null;
  truncated: boolean;
  updating: boolean;
  exportError: string | null;
  onDismissExportError: () => void;
  noun: string;
  children: ReactNode;
};

/** The states around a report's content. The filters stay above it in every state. */
export function ReportFrame({ query, hasData, empty, truncated, updating, exportError, onDismissExportError, noun, children }: ReportFrameProps) {
  const retry = () => void query.refetch();
  return (
    <div className="flex flex-col gap-4">
      {exportError ? (
        <Banner
          title="Couldn't export the CSV"
          actions={
            <Button variant="outline" size="sm" onClick={onDismissExportError}>
              Dismiss
            </Button>
          }
        >
          {exportError}
        </Banner>
      ) : null}
      {updating ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          Updating the {noun}…
        </p>
      ) : null}
      {query.isPending ? (
        <div className="rounded-xl bg-card shadow-card">
          <LoadingRows rows={6} label={`Loading the ${noun}…`} />
        </div>
      ) : query.isError && !hasData ? (
        <div className="rounded-xl bg-card shadow-card">
          <ErrorState title={`Couldn't load the ${noun}`} message={getErrorMessage(query.error)} onRetry={retry} />
        </div>
      ) : (
        <>
          {query.isError ? (
            <Banner
              variant="warning"
              actions={
                <Button variant="outline" size="sm" onClick={retry}>
                  Retry
                </Button>
              }
            >
              {getErrorMessage(query.error)} The figures below are from the previous filters.
            </Banner>
          ) : null}
          {empty ? (
            <div className="rounded-xl bg-card shadow-card">
              <EmptyState title={empty.title} message={empty.message} />
            </div>
          ) : (
            <>
              {truncated ? <Banner variant="info">{TRUNCATED_MESSAGE}</Banner> : null}
              {children}
            </>
          )}
        </>
      )}
    </div>
  );
}
