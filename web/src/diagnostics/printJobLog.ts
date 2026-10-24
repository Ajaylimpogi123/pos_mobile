/**
 * The print jobs this terminal sent, as last seen (Hardening & Pilot §I).
 * `GET /print-jobs` only answers for known ULIDs, so the terminal keeps its own
 * short log in `localStorage` (`pos.printJobLog`, newest 50) to know:
 * - each printer's latest finished job (the heartbeat's `printers[].ok`, the checklist);
 * - which jobs are still `queued` (the print-agent check).
 * A job first seen as `failed` is reported to the error log ("a print job that ends failed").
 */
import { captureError } from '@/diagnostics/errorQueue';
import type { PrintJob, PrintJobStatus } from '@/services/types';

const LOG_KEY = 'pos.printJobLog';
const LOG_MAX = 50;

const listeners = new Set<() => void>();
/** Bumped on every write: a cheap `useSyncExternalStore` snapshot. */
let version = 0;

/** For `useSyncExternalStore`: called whenever the log changes. */
export function subscribePrintJobLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function printJobLogVersion(): number {
  return version;
}

export type LoggedPrintJob = {
  ulid: string;
  printer_id: number;
  printer_name: string;
  kind: PrintJob['kind'];
  status: PrintJobStatus;
  last_error: string | null;
  created_at: string;
  printed_at: string | null;
  /** When this terminal first saw the current status (ISO). */
  checked_at: string;
};

function isLogged(value: unknown): value is LoggedPrintJob {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LoggedPrintJob>;
  return typeof entry.ulid === 'string' && typeof entry.printer_id === 'number' && typeof entry.status === 'string';
}

export function readPrintJobLog(): LoggedPrintJob[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isLogged) : [];
  } catch {
    return [];
  }
}

function writeLog(entries: LoggedPrintJob[]): void {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable: the checks fall back to "no job yet".
  }
  version += 1;
  for (const listener of listeners) listener();
}

function byNewest(a: LoggedPrintJob, b: LoggedPrintJob): number {
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

/** Records the server's view of some jobs (every print-job response goes through here). Never throws. */
export function recordPrintJobs(jobs: readonly PrintJob[]): void {
  if (jobs.length === 0) return;
  try {
    const now = new Date().toISOString();
    const log = readPrintJobLog();
    for (const job of jobs) {
      const index = log.findIndex((entry) => entry.ulid === job.ulid);
      const previous = index === -1 ? null : log[index];
      if (job.status === 'failed' && previous?.status !== 'failed') {
        captureError({
          level: 'error',
          message: `Print job failed: ${job.last_error ?? 'no reason given'}`,
          extra: { kind: job.kind, printer_id: String(job.printer_id), attempts: String(job.attempts) },
        });
      }
      const entry: LoggedPrintJob = {
        ulid: job.ulid,
        printer_id: job.printer_id,
        printer_name: job.printer_name,
        kind: job.kind,
        status: job.status,
        last_error: job.last_error,
        created_at: job.created_at,
        printed_at: job.printed_at,
        checked_at: previous && previous.status === job.status ? previous.checked_at : now,
      };
      if (index === -1) log.push(entry);
      else log[index] = entry;
    }
    writeLog(log.sort(byNewest).slice(0, LOG_MAX));
  } catch {
    // The log is a convenience: never break printing.
  }
}

/** A printer's newest job that finished (`printed` or `failed`), or `null`. */
export function latestFinishedJob(printerId: number, log: readonly LoggedPrintJob[] = readPrintJobLog()): LoggedPrintJob | null {
  return (
    log
      .filter((entry) => entry.printer_id === printerId && (entry.status === 'printed' || entry.status === 'failed'))
      .sort(byNewest)[0] ?? null
  );
}

/** The ULIDs still `queued` or `printing` (at most 50, the `GET /print-jobs` cap). */
export function unsettledPrintJobUlids(log: readonly LoggedPrintJob[] = readPrintJobLog()): string[] {
  return log
    .filter((entry) => entry.status === 'queued' || entry.status === 'printing')
    .map((entry) => entry.ulid)
    .slice(0, 50);
}
