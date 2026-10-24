/**
 * The print queue (docs/api-contract.md → Printing → Queue). Jobs are rows in
 * SQLite (`print_jobs`); this module runs them.
 *
 * - **Lanes:** one lane per `host:port`, one job at a time in each lane, and
 *   lanes run in parallel, so a dead kitchen printer never delays the receipt.
 * - **Send time:** host, port, width and receipt lines come from the
 *   **current** config when a job runs, so fixing a wrong IP and pressing
 *   Retry works. A printer that was removed or turned off fails the job.
 * - **Retries:** connect-phase errors (nothing was written) are tried up to
 *   3 times: at once, then +2 s, then +4 s. A write error (bytes may have
 *   reached the printer) is **never** retried automatically.
 * - **Lane breaker:** when a job runs out of attempts, the other jobs waiting
 *   in that lane fail at once with the same message.
 * - Nothing here throws to its caller: every outcome is written to the job.
 *
 * Pure apart from its `deps` (repository, transport, config, renderer, clock,
 * sleep), so tests drive it with a fake transport and an instant sleep.
 */
import type { JobChanges, PrintRepository } from '@/db/printRepository';
import type { PrintJobRow } from '@/db/schema';
import type { PrintConfig, Printer } from '@/services/types';
import { toJobView } from '@/stores/printing';
import { showToast } from '@/stores/toast';

import { jobLabel } from './labels';
import { isPrintTransportError, PrintTransportError, type PrintTarget, type PrintTransport } from './transport';

/** Contract: a 5 s connect timeout. */
export const CONNECT_TIMEOUT_MS = 5_000;
/** Contract: 3 attempts, at 0 s, +2 s and +4 s. */
export const RETRY_DELAYS_MS = [2_000, 4_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/**
 * A send that never settles (a native bug) is abandoned after this long and
 * treated like a write error. The native module's own write watchdog (20 s)
 * normally ends it first.
 */
export const SEND_DEADLINE_MS = 45_000;

export type QueueDeps = {
  repository: Pick<PrintRepository, 'getJob' | 'updateJob'>;
  getTransport: () => PrintTransport;
  /** The current print config (read at send time). */
  getConfig: () => PrintConfig | null;
  /** The document's bytes for this job, with the current config and printer. */
  render: (job: PrintJobRow, config: PrintConfig, printer: Printer) => Uint8Array;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Called after every change of a job (the store shows it). */
  onJobChanged: (job: PrintJobRow) => void;
  sendDeadlineMs?: number;
};

/** "Kitchen isn't responding." and friends (per error kind). */
export function failureMessage(printerName: string, error: PrintTransportError): string {
  switch (error.code) {
    case 'timeout':
    case 'refused':
    case 'unreachable':
      return `${printerName} isn't responding.`;
    case 'host':
      return `${printerName}'s address can't be found. Check it in Printers.`;
    case 'unavailable':
      return error.message;
    default:
      return writeFailureMessage(printerName);
  }
}

/** Contract: a write error's message. */
export function writeFailureMessage(printerName: string): string {
  return `${printerName} may have printed part of this. Check before retrying.`;
}

export function laneKeyOf(target: PrintTarget): string {
  return `${target.host.trim().toLowerCase()}:${target.port}`;
}

type LaneTask = { kind: 'job'; id: string } | { kind: 'task'; run: () => Promise<void> };

type Lane = { tasks: LaneTask[]; running: boolean };

type JobOutcome = 'sent' | 'failed' | 'exhausted' | 'skipped';

export type PrintQueue = {
  /** Queues these `pending` jobs in their lanes. */
  enqueue: (ids: readonly string[]) => Promise<void>;
  /** Runs `task` in `target`'s lane (e.g. a test print) and returns its result. */
  runInLane: <T>(target: PrintTarget, task: () => Promise<T>) => Promise<T>;
  /** A job or task is running or waiting in this lane. */
  isBusy: (target: PrintTarget) => boolean;
  /** Resolves when every lane is empty. */
  idle: () => Promise<void>;
};

export function createPrintQueue(deps: QueueDeps): PrintQueue {
  const lanes = new Map<string, Lane>();
  let idleWaiters: (() => void)[] = [];

  function notifyIdle() {
    if (lanes.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function change(job: PrintJobRow, changes: JobChanges): Promise<PrintJobRow> {
    const updatedAt = new Date(deps.now()).toISOString();
    const next: PrintJobRow = { ...job, ...changes, updated_at: updatedAt };
    try {
      await deps.repository.updateJob(job.id, changes, updatedAt);
    } catch {
      // The on-screen status still moves on; the row is fixed by the next change or startup recovery.
    }
    deps.onJobChanged(next);
    return next;
  }

  async function sendWithDeadline(transport: PrintTransport, target: PrintTarget, bytes: Uint8Array): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new PrintTransportError('write', 'The printer never finished receiving.')),
        deps.sendDeadlineMs ?? SEND_DEADLINE_MS,
      );
    });
    try {
      await Promise.race([transport.send(target, bytes, CONNECT_TIMEOUT_MS), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function currentPrinter(job: PrintJobRow): { config: PrintConfig; printer: Printer } | null {
    const config = deps.getConfig();
    const printer = config?.printers.find((candidate) => candidate.id === job.printer_id);
    return config && printer ? { config, printer } : null;
  }

  async function runJob(id: string): Promise<{ outcome: JobOutcome; message: string | null }> {
    let job = await deps.repository.getJob(id);
    if (!job || job.status !== 'pending') return { outcome: 'skipped', message: null };

    const current = currentPrinter(job);
    if (!current) {
      const message = `${job.printer_name} is no longer in the printer list.`;
      await change(job, { status: 'failed', error: message });
      return { outcome: 'failed', message };
    }
    const { config, printer } = current;
    if (!printer.is_enabled) {
      const message = `${printer.name} is turned off in Printers.`;
      await change(job, { status: 'failed', error: message });
      return { outcome: 'failed', message };
    }

    let bytes: Uint8Array;
    try {
      bytes = deps.render(job, config, printer);
    } catch {
      const message = "This couldn't be prepared for printing.";
      await change(job, { status: 'failed', error: message });
      return { outcome: 'failed', message };
    }

    const transport = deps.getTransport();
    const target: PrintTarget = { host: printer.host, port: printer.port };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      job = await change(job, { status: 'printing', attempts: attempt, error: null });
      try {
        await sendWithDeadline(transport, target, bytes);
        await change(job, { status: 'sent', error: null });
        // MASTER §6 / contract (Printing → Screens): "Sent", never "Printed" (port 9100 gives no confirmation).
        // Failures stay banners with Retry.
        showToast(`Sent: ${jobLabel(toJobView(job))} to ${job.printer_name}`);
        return { outcome: 'sent', message: null };
      } catch (raw) {
        const error = isPrintTransportError(raw) ? raw : new PrintTransportError('unknown', String(raw));
        const message = failureMessage(printer.name, error);
        if (error.retryable && attempt < MAX_ATTEMPTS) {
          await deps.sleep(RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }
        await change(job, { status: 'failed', error: message });
        return { outcome: error.retryable ? 'exhausted' : 'failed', message };
      }
    }
    return { outcome: 'failed', message: null };
  }

  /** The lane breaker: fail every job still waiting in the lane. */
  async function failWaitingJobs(lane: Lane, message: string) {
    const waiting = lane.tasks.filter((task): task is { kind: 'job'; id: string } => task.kind === 'job');
    lane.tasks = lane.tasks.filter((task) => task.kind !== 'job');
    for (const task of waiting) {
      const job = await deps.repository.getJob(task.id);
      if (job && job.status === 'pending') await change(job, { status: 'failed', error: message });
    }
  }

  async function pump(key: string, lane: Lane) {
    lane.running = true;
    try {
      for (let task = lane.tasks.shift(); task; task = lane.tasks.shift()) {
        if (task.kind === 'task') {
          await task.run();
          continue;
        }
        try {
          const result = await runJob(task.id);
          if (result.outcome === 'exhausted' && result.message) await failWaitingJobs(lane, result.message);
        } catch {
          // runJob records its own failures; a storage error must not stop the lane.
        }
      }
    } finally {
      lane.running = false;
      lanes.delete(key);
      notifyIdle();
    }
  }

  function schedule(key: string, task: LaneTask) {
    let lane = lanes.get(key);
    if (!lane) {
      lane = { tasks: [], running: false };
      lanes.set(key, lane);
    }
    lane.tasks.push(task);
    if (!lane.running) void pump(key, lane);
  }

  async function enqueue(ids: readonly string[]) {
    for (const id of ids) {
      try {
        const job = await deps.repository.getJob(id);
        if (!job) continue;
        const current = currentPrinter(job);
        const key = current ? laneKeyOf(current.printer) : `printer:${job.printer_id}`;
        schedule(key, { kind: 'job', id });
      } catch {
        // Unreadable job: it stays pending and startup recovery marks it failed.
      }
    }
  }

  function runInLane<T>(target: PrintTarget, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      schedule(laneKeyOf(target), {
        kind: 'task',
        run: async () => {
          try {
            resolve(await task());
          } catch (error) {
            reject(error);
          }
        },
      });
    });
  }

  return {
    enqueue,
    runInLane,
    isBusy: (target) => lanes.has(laneKeyOf(target)),
    idle: () =>
      lanes.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            idleWaiters.push(resolve);
          }),
  };
}
