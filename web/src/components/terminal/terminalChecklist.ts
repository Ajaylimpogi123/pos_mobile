/**
 * The "This terminal" checklist (Hardening & Pilot §I, five items): server
 * reachable, terminal registered, clock in sync, the receipt printer's last
 * job, and the print agent. Pure: built from the checks' results.
 */
import type { AgentHealth, PrinterHealth, ServerCheck } from '@/hooks/useTerminalHealth';
import { MAX_CLOCK_DRIFT_MS } from '@/hooks/useTerminalHealth';
import type { DeviceState } from '@/stores/session';
import { formatAgo } from '@/utils/dates';
import { formatBranchTime } from '@pos/core/businessDay';

export type CheckState = 'ok' | 'warn' | 'fail' | 'pending';

export type ChecklistItem = { key: string; title: string; state: CheckState; detail: string; hint?: string | null };

/** "+1 min 20 s" / "−45 s". */
export function formatDrift(ms: number): string {
  const sign = ms >= 0 ? '+' : '−';
  const seconds = Math.round(Math.abs(ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${sign}${minutes} min ${rest} s` : `${sign}${rest} s`;
}

const REACH_HINT = "Check this computer's network connection and that the server PC is on.";

export function buildChecklist(input: {
  server: ServerCheck;
  device: DeviceState;
  receipt: PrinterHealth | null;
  agent: AgentHealth;
  timezone: string;
}): ChecklistItem[] {
  const { server, device, receipt, agent, timezone } = input;
  const items: ChecklistItem[] = [];

  // 1. Server reachable
  if (server.state === 'checking') items.push({ key: 'server', title: 'Server reachable', state: 'pending', detail: 'Checking…' });
  else if (server.state === 'unreachable') items.push({ key: 'server', title: 'Server reachable', state: 'fail', detail: server.message, hint: REACH_HINT });
  else items.push({ key: 'server', title: 'Server reachable', state: 'ok', detail: `Answered in ${server.latencyMs} ms.` });

  // 2. Terminal registered
  const notRegistered = server.state === 'reachable' && server.notRegistered;
  if (device.status === 'registered' && !notRegistered) {
    items.push({ key: 'registered', title: 'Terminal registered', state: 'ok', detail: `Registered as ${device.device.code}.` });
  } else if (device.status === 'registering' || device.status === 'idle') {
    items.push({ key: 'registered', title: 'Terminal registered', state: 'pending', detail: 'Registering this terminal…' });
  } else {
    items.push({
      key: 'registered',
      title: 'Terminal registered',
      state: 'fail',
      detail: device.status === 'failed' ? device.message : notRegistered && server.state === 'reachable' ? server.message : 'Not registered.',
      hint: 'Log out and log in again. If it still fails, ask a manager to check Settings → Devices.',
    });
  }

  // 3. Clock in sync
  if (server.state === 'ok') {
    const inSync = Math.abs(server.driftMs) <= MAX_CLOCK_DRIFT_MS;
    items.push({
      key: 'clock',
      title: 'Clock in sync',
      state: inSync ? 'ok' : 'fail',
      detail: `This computer is ${formatDrift(server.driftMs)} from the server.`,
      hint: "Set this computer's date and time to update automatically.",
    });
  } else if (server.state === 'checking') {
    items.push({ key: 'clock', title: 'Clock in sync', state: 'pending', detail: 'Checking…' });
  } else {
    items.push({ key: 'clock', title: 'Clock in sync', state: 'warn', detail: "Can't compare without the server's time.", hint: 'Fix the items above, then Check now.' });
  }

  // 4. A receipt printer is chosen and its last job is OK
  if (!receipt) {
    items.push({
      key: 'printer',
      title: 'Receipt printer',
      state: 'fail',
      detail: 'No receipt printer is chosen for this terminal.',
      hint: 'Choose one under Printers below, or ask a manager to add a cashier printer.',
    });
  } else if (!receipt.lastJob) {
    items.push({
      key: 'printer',
      title: 'Receipt printer',
      state: 'warn',
      detail: `${receipt.printer.name}: nothing printed from this terminal yet.`,
      hint: 'Send a test print to check it.',
    });
  } else if (receipt.lastJob.status === 'printed') {
    items.push({
      key: 'printer',
      title: 'Receipt printer',
      state: 'ok',
      detail: `${receipt.printer.name}: last print OK${receipt.lastJob.printed_at ? ` at ${formatBranchTime(receipt.lastJob.printed_at, timezone) ?? ''}` : ''}.`,
    });
  } else {
    items.push({
      key: 'printer',
      title: 'Receipt printer',
      state: 'fail',
      detail: `${receipt.printer.name}: last print failed${receipt.lastJob.last_error ? ` (${receipt.lastJob.last_error})` : ''}.`,
      hint: 'Check the printer is on, has paper and is on the network, then send a test print.',
    });
  }

  // 5. The print agent
  if (agent.state === 'down') {
    items.push({
      key: 'agent',
      title: 'Print agent',
      state: 'fail',
      detail: `A print job has been waiting since ${formatAgo(agent.waitingSince) ?? agent.waitingSince}.`,
      hint: 'The print agent is not picking up jobs. Restart it on the server PC.',
    });
  } else {
    items.push({
      key: 'agent',
      title: 'Print agent',
      state: 'ok',
      detail: agent.lastPrintedAt ? `Last job printed ${formatAgo(agent.lastPrintedAt) ?? ''}. No job is waiting.` : 'No print job is waiting.',
    });
  }

  return items;
}
