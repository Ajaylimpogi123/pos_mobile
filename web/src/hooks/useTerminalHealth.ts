/**
 * "This terminal" (Hardening & Pilot §I): the checks and actions of the web
 * terminal's health page.
 * - **Check now:** a heartbeat (the same `POST /devices/heartbeat`) measures
 *   reachability and latency and returns `server_time` for the clock drift
 *   (against the request's midpoint). A `409` means the terminal isn't registered.
 * - **Print agent:** this terminal's `queued` jobs (refreshed with
 *   `GET /print-jobs`) older than 2 min mean the agent is down.
 * - **Error reports:** the `pos.errorQueue` count; **Send now** flushes it.
 * - **Send diagnostics:** a heartbeat plus a flush, then "Sent at hh:mm".
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { flushErrorQueue, pendingErrorCount, subscribeErrorQueue } from '@/diagnostics/errorQueue';
import { refreshPrintJobLog, sendTerminalHeartbeat, terminalPrinters } from '@/diagnostics/heartbeat';
import { latestFinishedJob, printJobLogVersion, readPrintJobLog, subscribePrintJobLog, type LoggedPrintJob } from '@/diagnostics/printJobLog';
import { noteHeartbeatSent } from '@/hooks/useTerminalHeartbeat';
import { getErrorMessage, isApiError } from '@/services/api';
import type { PrintConfig, Printer } from '@/services/types';

/** §E: |drift| ≤ 2 min is in sync. */
export const MAX_CLOCK_DRIFT_MS = 2 * 60_000;
/** §I: a job still `queued` after 2 min means the print agent is down. */
export const AGENT_STALE_MS = 2 * 60_000;

export type ServerCheck =
  | { state: 'checking' }
  | { state: 'ok'; latencyMs: number; serverTime: string; driftMs: number; checkedAt: number }
  /** The server answered but the terminal isn't registered (409), or another error. */
  | { state: 'reachable'; latencyMs: number; message: string; notRegistered: boolean; checkedAt: number }
  | { state: 'unreachable'; message: string; checkedAt: number };

export type PrinterHealth = { printer: Printer; lastJob: LoggedPrintJob | null };

export type AgentHealth = { state: 'down'; waitingSince: string } | { state: 'ok'; lastPrintedAt: string | null };

async function runServerCheck(): Promise<ServerCheck> {
  const started = Date.now();
  try {
    const response = await sendTerminalHeartbeat();
    const finished = Date.now();
    noteHeartbeatSent();
    const serverMs = Date.parse(response.server_time);
    return {
      state: 'ok',
      latencyMs: finished - started,
      serverTime: response.server_time,
      // Positive: this computer's clock is ahead of the server's.
      driftMs: Number.isNaN(serverMs) ? 0 : Math.round((started + finished) / 2 - serverMs),
      checkedAt: finished,
    };
  } catch (error) {
    const finished = Date.now();
    if (isApiError(error) && error.status !== null) {
      return { state: 'reachable', latencyMs: finished - started, message: error.message, notRegistered: error.status === 409, checkedAt: finished };
    }
    return { state: 'unreachable', message: getErrorMessage(error), checkedAt: finished };
  }
}

function agentHealth(log: readonly LoggedPrintJob[], now: number): AgentHealth {
  const stale = log.filter((entry) => entry.status === 'queued' && now - Date.parse(entry.created_at) > AGENT_STALE_MS);
  if (stale.length > 0) {
    const oldest = stale.reduce((a, b) => (Date.parse(a.created_at) <= Date.parse(b.created_at) ? a : b));
    return { state: 'down', waitingSince: oldest.created_at };
  }
  const printed = log.filter((entry) => entry.status === 'printed' && entry.printed_at).map((entry) => entry.printed_at as string);
  printed.sort((a, b) => Date.parse(b) - Date.parse(a));
  return { state: 'ok', lastPrintedAt: printed[0] ?? null };
}

export function useTerminalHealth(config: PrintConfig | null, receiptPrinterId: number | null) {
  const [server, setServer] = useState<ServerCheck>({ state: 'checking' });
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const errorsPending = useSyncExternalStore(subscribeErrorQueue, pendingErrorCount);
  const logVersion = useSyncExternalStore(subscribePrintJobLog, printJobLogVersion);

  const check = useCallback(async () => {
    setServer({ state: 'checking' });
    const [result] = await Promise.all([runServerCheck(), refreshPrintJobLog()]);
    setServer(result);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    // The first check on open; `check` only sets state after its requests resolve.
    let cancelled = false;
    void Promise.all([runServerCheck(), refreshPrintJobLog()]).then(([result]) => {
      if (cancelled) return;
      setServer(result);
      setNow(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const log = useMemo(() => {
    void logVersion;
    return readPrintJobLog();
  }, [logVersion]);

  const printers = useMemo<PrinterHealth[]>(
    () => (config ? terminalPrinters(config, receiptPrinterId).map((printer) => ({ printer, lastJob: latestFinishedJob(printer.id, log) })) : []),
    [config, log, receiptPrinterId],
  );

  const agent = useMemo(() => agentHealth(log, now), [log, now]);

  const sendErrors = useCallback(async () => {
    setFlushing(true);
    try {
      await flushErrorQueue();
    } finally {
      setFlushing(false);
    }
  }, []);

  const sendDiagnostics = useCallback(async () => {
    setSending(true);
    try {
      const [result] = await Promise.all([runServerCheck(), flushErrorQueue(), refreshPrintJobLog()]);
      setServer(result);
      setNow(Date.now());
      if (result.state === 'ok') setSentAt(Date.now());
    } finally {
      setSending(false);
    }
  }, []);

  return { server, check, printers, agent, errorsPending, sendErrors, flushing, sendDiagnostics, sending, sentAt };
}
