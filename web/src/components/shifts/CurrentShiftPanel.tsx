/**
 * This terminal's shift (Shifts & Reporting → Device rules, online only):
 * - no open shift: the **Open a shift** card (reused from the POS gate);
 * - open: who opened it and when, four stat cards from the server's live
 *   report, the actions (**Cash in**, **Cash out**, **Print X-read**,
 *   **Close shift**) by permission, and the live X-read;
 * - just closed: the Z-read (the server's final report) with its print status
 *   and **Reprint Z-read**.
 */
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanknoteIcon,
  LockIcon,
  PrinterIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  ShoppingBagIcon,
  Undo2Icon,
  WalletIcon,
} from 'lucide-react';

import { Banner } from '@/components/common/Banner';
import { ErrorState } from '@/components/common/ListStates';
import { StatCard } from '@/components/common/StatCard';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { OpenShiftCard } from '@/components/sell/OpenShiftCard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { registerTerminal } from '@/hooks/useAuth';
import { useCurrentShift } from '@/hooks/useCurrentShift';
import { useShiftActions } from '@/hooks/useShiftActions';
import type { Shift } from '@/services/types';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { useTerminalStore } from '@/stores/terminal';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { formatBranchDateTime, formatBranchTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';

import { CashMovementDialog, CloseShiftDialog } from './ShiftDialogs';
import { ShiftReportView } from './ShiftReportView';
import { ShiftFlagBadges, ShiftStatusBadge } from './ShiftStatus';

function StatCards({ shift }: { shift: Shift }) {
  const { report } = shift;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Net sales" value={formatPeso(report.net_sales_cents)} icon={WalletIcon} accent="sales" footnote={`Gross ${formatPeso(report.gross_sales_cents)}`} />
      <StatCard label="Orders" value={report.orders_count.toLocaleString('en-PH')} icon={ShoppingBagIcon} accent="orders" footnote={`${report.items_sold.toLocaleString('en-PH')} items sold`} />
      <StatCard
        label="Expected cash"
        value={formatPeso(report.expected_cash_cents)}
        icon={BanknoteIcon}
        accent="neutral"
        footnote={`Opening float ${formatPeso(shift.opening_float_cents)}`}
      />
      <StatCard
        label="Refunds"
        value={formatPeso(report.refunds_cents ?? 0)}
        icon={Undo2Icon}
        accent="stock"
        footnote={`${report.voids_count ?? 0} voided · ${report.refunds_count ?? 0} refunded`}
      />
    </div>
  );
}

export function CurrentShiftPanel() {
  const user = useSessionStore((state) => state.user);
  const deviceState = useSessionStore((state) => state.device);
  const device = registeredDevice(deviceState);
  const gateNotice = useTerminalStore((state) => state.gateNotice);
  const current = useCurrentShift({ live: true });
  const actions = useShiftActions(current.shift);
  const timezone = user?.branch.timezone ?? 'Asia/Manila';

  const canOpen = hasPermission(user, PERMISSIONS.shiftOpen);
  const canClose = hasPermission(user, PERMISSIONS.shiftClose);

  if (actions.closed) {
    const closed = actions.closed;
    return (
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Shift closed · Z-read</h2>
            <p className="text-sm text-muted-foreground">
              Terminal {closed.device.code} · {formatBranchDateTime(closed.opened_at, timezone) ?? closed.opened_at} to{' '}
              {closed.closed_at ? (formatBranchDateTime(closed.closed_at, timezone) ?? closed.closed_at) : '…'}
              {closed.closed_by ? ` · Closed by ${closed.closed_by.name}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={actions.reprintZRead} disabled={actions.zRead.starting}>
              <PrinterIcon aria-hidden="true" />
              Reprint Z-read
            </Button>
            <Button variant="green" onClick={actions.dismissClosed}>
              Done
            </Button>
          </div>
        </div>
        <PrintJobList tracker={actions.zRead.tracker} notices={actions.zRead.notices} title="Z-read printing" />
        {closed.close_note ? <p className="text-sm">Note: {closed.close_note}</p> : null}
        <ShiftReportView report={closed.report} openingFloatCents={closed.opening_float_cents} countedCashCents={closed.counted_cash_cents} />
      </Card>
    );
  }

  if (deviceState.status === 'failed') {
    return (
      <Card>
        <ErrorState
          title="This terminal isn't set up yet"
          message={`${deviceState.message} Shifts need a registered terminal.`}
          onRetry={() => void registerTerminal()}
        />
      </Card>
    );
  }
  if (!device || current.loading) {
    return (
      <Card className="flex flex-col gap-3 p-5" aria-busy="true">
        <span className="sr-only">Loading this terminal's shift…</span>
        <Skeleton className="h-6 w-60" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      </Card>
    );
  }
  if (current.error && !current.shift) {
    return (
      <Card>
        <ErrorState title="Couldn't read the shift" message={current.error} onRetry={current.reload} />
      </Card>
    );
  }

  const shift = current.shift;
  if (!shift) {
    return <OpenShiftCard canOpen={canOpen} notice={gateNotice} />;
  }

  const updated = current.updatedAt ? formatBranchTime(new Date(current.updatedAt).toISOString(), timezone) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">Terminal {shift.device.code}</h2>
              <ShiftStatusBadge status={shift.status} />
              <ShiftFlagBadges flags={shift.flags} />
            </div>
            <p className="text-sm text-muted-foreground">
              Opened {formatBranchDateTime(shift.opened_at, timezone) ?? shift.opened_at} by {shift.opened_by.name} · Opening float{' '}
              {formatPeso(shift.opening_float_cents)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canOpen ? (
              <>
                <Button variant="outline" onClick={() => actions.openCash('in')}>
                  <ArrowDownToLineIcon aria-hidden="true" />
                  Cash in
                </Button>
                <Button variant="outline" onClick={() => actions.openCash('out')}>
                  <ArrowUpFromLineIcon aria-hidden="true" />
                  Cash out
                </Button>
                <Button variant="outline" onClick={actions.printXRead} disabled={actions.xRead.starting}>
                  <ReceiptTextIcon aria-hidden="true" />
                  Print X-read
                </Button>
              </>
            ) : null}
            {canClose ? (
              <Button variant="destructive" onClick={actions.openClose}>
                <LockIcon aria-hidden="true" />
                Close shift
              </Button>
            ) : null}
          </div>
        </div>
        {actions.flash ? (
          <Banner
            variant="success"
            actions={
              <Button variant="ghost" size="sm" onClick={actions.dismissFlash}>
                Dismiss
              </Button>
            }
          >
            {actions.flash}
          </Banner>
        ) : null}
        {current.error ? <Banner variant="warning">{`The report couldn't be refreshed: ${current.error}`}</Banner> : null}
        <PrintJobList tracker={actions.xRead.tracker} notices={actions.xRead.notices} title="X-read printing" />
      </Card>

      <StatCards shift={shift} />

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">X-read (live)</h2>
            <p className="text-[13px] text-muted-foreground" aria-live="polite">
              From the server{updated ? `, updated ${updated}` : ''}. It refreshes every 30 seconds.
            </p>
          </div>
          <Button variant="outline" onClick={current.reload} disabled={current.refreshing}>
            <RefreshCwIcon className={current.refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
            {current.refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        <ShiftReportView report={shift.report} openingFloatCents={shift.opening_float_cents} countedCashCents={null} />
      </Card>

      <CashMovementDialog actions={actions} />
      <CloseShiftDialog actions={actions} />
    </div>
  );
}
