/**
 * "This terminal" (Hardening & Pilot §I), route `/device`, for every signed-in
 * user: the tablet's §E layout without the outbox and version items. The
 * checklist on top, then Server (Check now), This terminal, Printers (Test
 * print, for `settings.manage` / `system.manage`), Error reports (Send now) and
 * Send diagnostics. The checks and actions live in `useTerminalHealth`.
 */
import { LoaderCircleIcon, PrinterIcon, RefreshCwIcon, SendIcon } from 'lucide-react';
import { useMemo } from 'react';

import { Banner } from '@/components/common/Banner';
import { PlainPage } from '@/components/common/PageBand';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { ReceiptPrinterPicker } from '@/components/printing/ReceiptPrinterPicker';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { buildChecklist, formatDrift } from '@/components/terminal/terminalChecklist';
import { Checklist, Facts, Section } from '@/components/terminal/TerminalSections';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/constants/appVersion';
import { useTestPrinting } from '@/hooks/useOrderPrinting';
import { usePrintConfig, useReceiptPrinter } from '@/hooks/usePrintConfig';
import { useTerminalHealth } from '@/hooks/useTerminalHealth';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { getInstallId } from '@/stores/terminal';
import { formatAgo } from '@/utils/dates';
import { hasAnyPermission, PERMISSIONS } from '@/utils/permissions';
import { browserVersion } from '@/utils/terminalName';
import { formatBranchDateTime, formatBranchTime } from '@pos/core/businessDay';

const ROLE_LABELS = { cashier: 'Receipts', kitchen: 'Kitchen', bar: 'Bar' } as const;

export function TerminalPage() {
  useShellHeader('This terminal');
  const user = useSessionStore((state) => state.user);
  const deviceState = useSessionStore((state) => state.device);
  const device = registeredDevice(deviceState);
  const timezone = user?.branch.timezone ?? 'Asia/Manila';
  const canTest = hasAnyPermission(user, [PERMISSIONS.settingsManage, PERMISSIONS.systemManage]);

  const printConfig = usePrintConfig();
  const receiptChoice = useReceiptPrinter(printConfig.config);
  const health = useTerminalHealth(printConfig.config, receiptChoice.current?.id ?? null);
  const testing = useTestPrinting();
  const installId = useMemo(() => getInstallId(), []);

  const receipt = health.printers.find((entry) => entry.printer.id === receiptChoice.current?.id) ?? null;
  const checklist = buildChecklist({ server: health.server, device: deviceState, receipt, agent: health.agent, timezone });
  const { server } = health;
  const checking = server.state === 'checking';

  return (
    <PlainPage
      title="This terminal"
      subtitle="Is this computer ready to sell and print? Fix anything marked below."
      actions={
        <Button variant="outline" onClick={() => void health.check()} disabled={checking}>
          {checking ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <RefreshCwIcon aria-hidden="true" />}
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Checklist items={checklist} />

          <Section title="Server">
            <Facts
              rows={[
                ['Address', window.location.origin],
                [
                  'Reachable',
                  checking ? 'Checking…' : server.state === 'unreachable' ? <span className="font-medium text-danger">No: {server.message}</span> : 'Yes',
                ],
                ['Latency', server.state === 'ok' || server.state === 'reachable' ? `${server.latencyMs} ms` : '—'],
                ['Server time', server.state === 'ok' ? (formatBranchDateTime(server.serverTime, timezone) ?? server.serverTime) : '—'],
                ['Clock difference', server.state === 'ok' ? formatDrift(server.driftMs) : '—'],
                ['Last checked', server.state === 'checking' ? 'Now' : (formatAgo(new Date(server.checkedAt).toISOString()) ?? '—')],
              ]}
            />
          </Section>

          <Section title="This terminal">
            <Facts
              rows={[
                ['Code', device?.code ?? '—'],
                ['Name', device?.name ?? '—'],
                ['Type', 'Web terminal'],
                ['Install ID', `…${installId.slice(-6)}`],
                ['App version', APP_VERSION],
                ['Browser', browserVersion()],
                ['Signed in as', user ? `${user.name} (${user.role.name})` : '—'],
              ]}
            />
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <Section title="Printers" actions={<ReceiptPrinterPicker choice={receiptChoice} />}>
            {printConfig.error ? (
              <Banner actions={<Button variant="outline" size="sm" onClick={printConfig.reload}>Retry</Button>}>{printConfig.error}</Banner>
            ) : printConfig.loading ? (
              <p className="text-sm text-muted-foreground" aria-busy="true">
                Loading printers…
              </p>
            ) : health.printers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No printers are set up for this branch.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {health.printers.map(({ printer, lastJob }) => (
                  <li key={printer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {printer.name}
                        <span className="font-normal text-muted-foreground"> · {ROLE_LABELS[printer.role]}</span>
                      </p>
                      <p className="text-sm">
                        {!lastJob ? (
                          <span className="text-muted-foreground">Nothing printed from this terminal yet</span>
                        ) : lastJob.status === 'printed' ? (
                          <span className="text-success">
                            Last print OK{lastJob.printed_at ? ` at ${formatBranchTime(lastJob.printed_at, timezone) ?? ''}` : ''}
                          </span>
                        ) : (
                          <span className="text-danger">Last print failed{lastJob.last_error ? `: ${lastJob.last_error}` : ''}</span>
                        )}
                      </p>
                    </div>
                    {canTest ? (
                      <Button variant="outline" size="sm" onClick={() => testing.printTest(printer.id)}>
                        <PrinterIcon aria-hidden="true" />
                        Test print
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {testing.tracker.jobs.length > 0 || testing.notice ? (
              <PrintJobList tracker={testing.tracker} notices={testing.notice ? [testing.notice] : []} title="Test prints" />
            ) : null}
          </Section>

          <Section
            title="Error reports"
            actions={
              <Button variant="outline" size="sm" onClick={() => void health.sendErrors()} disabled={health.flushing || health.errorsPending === 0}>
                {health.flushing ? 'Sending…' : 'Send now'}
              </Button>
            }
          >
            <p className="text-sm">
              {health.errorsPending === 0
                ? 'No error reports waiting.'
                : `${health.errorsPending} error ${health.errorsPending === 1 ? 'report' : 'reports'} waiting to be sent.`}
            </p>
          </Section>

          <Section title="Send diagnostics">
            <p className="text-sm text-muted-foreground">Sends this terminal's status and any waiting error reports to the server now.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="green" onClick={() => void health.sendDiagnostics()} disabled={health.sending}>
                {health.sending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <SendIcon aria-hidden="true" />}
                {health.sending ? 'Sending…' : 'Send diagnostics'}
              </Button>
              {health.sentAt ? (
                <span className="text-sm font-medium text-success" role="status">
                  Sent at {formatBranchTime(new Date(health.sentAt).toISOString(), timezone)}
                </span>
              ) : null}
            </div>
            {!health.sending && health.sentAt === null && server.state !== 'ok' && server.state !== 'checking' ? (
              <p className="text-sm text-muted-foreground">Diagnostics are sent once the server is reachable and this terminal is registered.</p>
            ) : null}
          </Section>
        </div>
      </div>
    </PlainPage>
  );
}
