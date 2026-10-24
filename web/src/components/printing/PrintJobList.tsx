/**
 * One status row per print job (Web POS §F): the job's name, its printer and
 * its status, with **Retry** on a failed one. "Sent" (never "Printed"): the
 * agent reports that the printer took the bytes, not that paper came out
 * (the tablet's rule, Printing → Screens).
 */
import { LoaderCircleIcon, RotateCwIcon } from 'lucide-react';

import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PrintTracker, TrackedStatus } from '@/hooks/usePrintTracker';

const STATUS: Record<TrackedStatus, { tone: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
  sending: { tone: 'info', label: 'Sending…' },
  not_sent: { tone: 'danger', label: 'Not sent' },
  queued: { tone: 'info', label: 'Waiting' },
  printing: { tone: 'info', label: 'Printing…' },
  printed: { tone: 'success', label: 'Sent' },
  failed: { tone: 'danger', label: 'Failed' },
};

type PrintJobListProps = {
  tracker: PrintTracker;
  notices?: readonly string[];
  /** "Not sent to any printer: …". */
  unrouted?: string | null;
  title?: string;
};

export function PrintJobList({ tracker, notices = [], unrouted = null, title = 'Printing' }: PrintJobListProps) {
  const { jobs } = tracker;
  if (jobs.length === 0 && notices.length === 0 && !unrouted) return null;

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {jobs.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card" aria-live="polite">
          {jobs.map((job) => {
            const status = STATUS[job.status];
            const canRetry = job.status === 'failed' || job.status === 'not_sent';
            return (
              <li key={job.ulid} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{job.label}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {job.printerName}
                    {job.error ? <span className="text-danger"> · {job.error}</span> : null}
                  </p>
                </div>
                <StatusBadge tone={status.tone} label={status.label} />
                {canRetry ? (
                  <Button variant="outline" size="sm" onClick={() => void tracker.retry(job.ulid)} disabled={job.busy}>
                    {job.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <RotateCwIcon aria-hidden="true" />}
                    Retry
                    <span className="sr-only"> {job.label}</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {tracker.stalled ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-warning">
          <span>Still waiting for the print agent. Check that it is running on the restaurant PC.</span>
          <Button variant="outline" size="sm" onClick={tracker.checkAgain}>
            Check again
          </Button>
        </div>
      ) : null}
      {notices.map((notice) => (
        <p key={notice} className="text-[13px] font-medium text-warning">
          {notice}
        </p>
      ))}
      {unrouted ? <p className="text-[13px] font-medium text-warning">{unrouted}</p> : null}
    </section>
  );
}
