/**
 * Sends print jobs to the server's queue and follows them (Web POS §D/§F):
 * - each planned job is `POST /print-jobs` (a failed POST keeps the same body
 *   and ULID, so **Retry** resends it safely: the server is idempotent by `ulid`);
 * - while any job is `queued` or `printing`, `GET /print-jobs?ulids[]=` runs
 *   every 2 s, for up to 60 s (then **Check again** restarts the window);
 * - **Retry** on a `failed` job is `POST /print-jobs/{ulid}/retry`.
 * Printing never throws into the sale flow: every failure becomes a row status.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { PlannedJob } from '@/printing/printActions';
import { getErrorMessage } from '@/services/api';
import { createPrintJob, listPrintJobs, retryPrintJob } from '@/services/printing';
import type { PrintJob, PrintJobCreateRequest } from '@/services/types';

export const POLL_INTERVAL_MS = 2_000;
export const POLL_WINDOW_MS = 60_000;

/** `sending`: the POST is in flight. `not_sent`: the POST failed (Retry resends it). The rest are the server's statuses. */
export type TrackedStatus = 'sending' | 'not_sent' | PrintJob['status'];

export type TrackedJob = {
  ulid: string;
  label: string;
  printerName: string;
  status: TrackedStatus;
  error: string | null;
  attempts: number;
  request: PrintJobCreateRequest;
  /** A Retry request is in flight. */
  busy: boolean;
};

export type PrintTracker = {
  jobs: TrackedJob[];
  /** Some job is still `queued` or `printing` after the 60 s window. */
  stalled: boolean;
  polling: boolean;
  send: (planned: readonly PlannedJob[]) => Promise<void>;
  retry: (ulid: string) => Promise<void>;
  checkAgain: () => void;
  reset: () => void;
};

function isPending(status: TrackedStatus): boolean {
  return status === 'queued' || status === 'printing';
}

export function usePrintTracker(): PrintTracker {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);
  /** Bumped after every poll, so the next one is scheduled. */
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback((ulid: string, changes: Partial<TrackedJob>) => {
    if (!mounted.current) return;
    setJobs((current) => current.map((job) => (job.ulid === ulid ? { ...job, ...changes } : job)));
  }, []);

  const applyServer = useCallback(
    (job: PrintJob) => update(job.ulid, { status: job.status, error: job.last_error, attempts: job.attempts, busy: false }),
    [update],
  );

  const restartWindow = useCallback(() => {
    setStalled(false);
    setWindowStart(Date.now());
  }, []);

  const post = useCallback(
    async (request: PrintJobCreateRequest) => {
      update(request.ulid, { status: 'sending', error: null, busy: true });
      try {
        applyServer(await createPrintJob(request));
      } catch (error) {
        update(request.ulid, { status: 'not_sent', error: getErrorMessage(error), busy: false });
      }
    },
    [applyServer, update],
  );

  const send = useCallback(
    async (planned: readonly PlannedJob[]) => {
      if (planned.length === 0) return;
      setJobs((current) => [
        ...current,
        ...planned.map((job) => ({
          ulid: job.request.ulid,
          label: job.label,
          printerName: job.printerName,
          status: 'sending' as const,
          error: null,
          attempts: 0,
          request: job.request,
          busy: true,
        })),
      ]);
      restartWindow();
      // One after another, in plan order (receipts first): each is a small request.
      for (const job of planned) await post(job.request);
    },
    [post, restartWindow],
  );

  const retry = useCallback(
    async (ulid: string) => {
      const job = jobs.find((entry) => entry.ulid === ulid);
      if (!job || job.busy) return;
      restartWindow();
      if (job.status === 'not_sent') {
        await post(job.request);
        return;
      }
      update(ulid, { busy: true });
      try {
        applyServer(await retryPrintJob(ulid));
      } catch (error) {
        update(ulid, { busy: false, error: getErrorMessage(error) });
      }
    },
    [applyServer, jobs, post, restartWindow, update],
  );

  // MASTER §6 Toasts: a job the print agent finished is announced once. The wording is "Sent", never
  // "Printed" (docs/api-contract.md, Printing → Screens: port 9100 gives no confirmation). Failures stay in the list with Retry.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'printed' || announced.current.has(job.ulid)) continue;
      announced.current.add(job.ulid);
      toast.success(`Sent: ${job.label} to ${job.printerName}`);
    }
  }, [jobs]);

  const pendingUlids = jobs.filter((job) => isPending(job.status)).map((job) => job.ulid);
  const pendingKey = pendingUlids.join(',');
  const polling = windowStart !== null && pendingUlids.length > 0 && !stalled;

  useEffect(() => {
    if (windowStart === null || pendingKey === '' || stalled) return;
    const ulids = pendingKey.split(',').slice(0, 50);
    const timer = window.setTimeout(async () => {
      if (Date.now() - windowStart >= POLL_WINDOW_MS) {
        setStalled(true);
        return;
      }
      try {
        const found = await listPrintJobs(ulids);
        for (const job of found) applyServer(job);
      } catch {
        // A missed poll is tried again on the next tick.
      } finally {
        if (mounted.current) setTick((value) => value + 1);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [applyServer, pendingKey, stalled, windowStart, tick]);

  const reset = useCallback(() => {
    setJobs([]);
    setWindowStart(null);
    setStalled(false);
  }, []);

  return { jobs, stalled, polling, send, retry, checkAgain: restartWindow, reset };
}
