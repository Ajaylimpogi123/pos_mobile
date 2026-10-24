/**
 * The web terminal's heartbeat (Hardening & Pilot §I): `POST /devices/heartbeat`
 * with `app_version`, `os_version`, `errors_pending` and `printers`. No outbox
 * fields (the web sells online only). `printers` is this terminal's receipt
 * printer plus the enabled kitchen/bar printers; each one's `ok` is its latest
 * finished print job (`printed` = ok, `failed` = not ok, none = left out).
 */
import { APP_VERSION } from '@/constants/appVersion';
import { pendingErrorCount } from '@/diagnostics/errorQueue';
import { latestFinishedJob, readPrintJobLog, unsettledPrintJobUlids } from '@/diagnostics/printJobLog';
import { printConfigKey } from '@/hooks/usePrintConfig';
import { sendHeartbeat } from '@/services/devices';
import { getPrintConfig, listPrintJobs } from '@/services/printing';
import { queryClient } from '@/services/queryClient';
import type { HeartbeatPrinter, HeartbeatRequest, HeartbeatResponse, PrintConfig, Printer } from '@/services/types';
import { useTerminalStore } from '@/stores/terminal';
import { browserVersion } from '@/utils/terminalName';
import { chooseReceiptPrinter, isTicketPrinter } from '@pos/core/printing/routing';

/** §C: at most 20 printers per heartbeat. */
const MAX_PRINTERS = 20;

/** Refreshes the jobs still `queued` / `printing` (the log is updated by the service). Failures are ignored. */
export async function refreshPrintJobLog(): Promise<void> {
  const ulids = unsettledPrintJobUlids();
  if (ulids.length === 0) return;
  try {
    await listPrintJobs(ulids);
  } catch {
    // The next check tries again.
  }
}

/** The printers this terminal reports: its receipt printer, then the enabled ticket printers. */
export function terminalPrinters(config: PrintConfig, receiptPrinterId: number | null): Printer[] {
  const receipt = chooseReceiptPrinter(config.printers, receiptPrinterId);
  const tickets = config.printers.filter((printer) => printer.is_enabled && isTicketPrinter(printer));
  const all = receipt ? [receipt, ...tickets.filter((printer) => printer.id !== receipt.id)] : tickets;
  return all.slice(0, MAX_PRINTERS);
}

function printerStatuses(printers: readonly Printer[]): HeartbeatPrinter[] {
  const log = readPrintJobLog();
  const statuses: HeartbeatPrinter[] = [];
  for (const printer of printers) {
    const job = latestFinishedJob(printer.id, log);
    if (!job) continue;
    statuses.push({ id: printer.id, ok: job.status === 'printed', checked_at: job.printed_at ?? job.checked_at });
  }
  return statuses;
}

async function heartbeatBody(): Promise<HeartbeatRequest> {
  const body: HeartbeatRequest = {
    app_version: APP_VERSION,
    os_version: browserVersion(),
    errors_pending: pendingErrorCount(),
  };
  try {
    const config = await queryClient.fetchQuery({ queryKey: printConfigKey, queryFn: getPrintConfig, staleTime: 60_000 });
    await refreshPrintJobLog();
    body.printers = printerStatuses(terminalPrinters(config, useTerminalStore.getState().receiptPrinterId));
  } catch {
    // Without the print config the printers are left out.
  }
  return body;
}

/** Sends one heartbeat. Throws (the caller decides whether to show it); the background timer swallows it. */
export async function sendTerminalHeartbeat(): Promise<HeartbeatResponse> {
  return sendHeartbeat(await heartbeatBody());
}
