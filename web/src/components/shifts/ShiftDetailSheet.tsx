/**
 * One shift (Shifts screen → detail, `report.zread`): who opened and closed
 * it, its flags and note, and the server's `ShiftReport`, with **Reprint
 * Z-read** for a closed shift (marked `*** REPRINT ***`) or **Print X-read**
 * for an open one (`shift.open`), through the print queue.
 */
import { ClockIcon, PrinterIcon } from 'lucide-react';

import { useEffect, useRef } from 'react';

import { DetailPanel } from '@/components/common/DetailPanel';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { Button } from '@/components/ui/button';
import { isoSeconds } from '@/hooks/useCurrentShift';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { useShiftDetail } from '@/hooks/useShifts';
import { shiftReadDocument } from '@/printing/shiftDocument';
import type { Shift } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';

import { ShiftReportView } from './ShiftReportView';
import { ShiftFlagBadges, ShiftStatusBadge } from './ShiftStatus';

/** What the row menu asked for: `print` starts the Z-read reprint (closed) or the X-read (open) once loaded. */
export type ShiftDetailIntent = 'view' | 'print';

type ShiftDetailSheetProps = {
  ulid: string | null;
  onClose: () => void;
  /** `sheet` at ≥ 1280 px, `page` below (MASTER §6, `useDetailMode`). */
  mode: 'sheet' | 'page';
  intent?: ShiftDetailIntent;
};

export function ShiftDetailSheet({ ulid, onClose, mode, intent = 'view' }: ShiftDetailSheetProps) {
  const detail = useShiftDetail(ulid);
  const printing = useOrderPrinting();
  const user = useSessionStore((state) => state.user);
  const timezone = user?.branch.timezone ?? 'Asia/Manila';
  const shift = detail.shift;

  return (
    <DetailPanel
      mode={mode}
      open={ulid !== null}
      onClose={() => {
        printing.reset();
        onClose();
      }}
      sheetClassName="sm:max-w-3xl"
      backLabel="Back to shifts"
      title={
        <>
          <ClockIcon className="size-5" aria-hidden="true" />
          {shift ? `Shift · Terminal ${shift.device.code}` : 'Shift'}
        </>
      }
      description={shift ? `Opened ${formatBranchDateTime(shift.opened_at, timezone) ?? shift.opened_at} by ${shift.opened_by.name}` : 'Loading…'}
    >
      {detail.loading ? (
        <LoadingRows rows={6} label="Loading the shift…" />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : shift ? (
        <ShiftBody
          key={`${shift.ulid}-${intent}`}
          shift={shift}
          timezone={timezone}
          printing={printing}
          canPrintX={hasPermission(user, PERMISSIONS.shiftOpen)}
          branchName={user?.branch.name ?? null}
          intent={intent}
        />
      ) : null}
    </DetailPanel>
  );
}

type ShiftBodyProps = {
  shift: Shift;
  timezone: string;
  printing: ReturnType<typeof useOrderPrinting>;
  canPrintX: boolean;
  branchName: string | null;
  intent: ShiftDetailIntent;
};

function ShiftBody({ shift, timezone, printing, canPrintX, branchName, intent }: ShiftBodyProps) {
  const closed = shift.status === 'closed';
  const canPrint = closed || canPrintX;
  const printRef = useRef<HTMLElement>(null);

  function printRead() {
    printing.reset();
    void printing.printShiftRead(shiftReadDocument(shift, closed ? 'z_read' : 'x_read', branchName, isoSeconds(Date.now())), closed);
  }

  // The row menu's "Reprint Z-read" / "Print X-read", once, with its status shown below.
  const handled = useRef(false);
  const printReadRef = useRef(printRead);
  useEffect(() => {
    printReadRef.current = printRead;
  });
  useEffect(() => {
    if (handled.current || intent !== 'print' || !canPrint) return;
    handled.current = true;
    printRef.current?.scrollIntoView({ block: 'start' });
    printReadRef.current();
  }, [intent, canPrint]);
  return (
    <div className="flex flex-col gap-5 text-[15px]">
      <div className="flex flex-wrap items-center gap-2">
        <ShiftStatusBadge status={shift.status} />
        <ShiftFlagBadges flags={shift.flags} />
      </div>

      <dl className="grid gap-3 rounded-xl bg-subtle p-4 sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-muted-foreground">Opened</dt>
          <dd>
            {formatBranchDateTime(shift.opened_at, timezone) ?? shift.opened_at} · {shift.opened_by.name}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Closed</dt>
          <dd>
            {shift.closed_at
              ? `${formatBranchDateTime(shift.closed_at, timezone) ?? shift.closed_at}${shift.closed_by ? ` · ${shift.closed_by.name}` : ''}`
              : 'Still open'}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Opening float</dt>
          <dd className="tabular">{formatPeso(shift.opening_float_cents)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Counted cash</dt>
          <dd className="tabular">{shift.counted_cash_cents !== null ? formatPeso(shift.counted_cash_cents) : 'Not counted'}</dd>
        </div>
        {shift.close_note ? (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted-foreground">Note</dt>
            <dd>{shift.close_note}</dd>
          </div>
        ) : null}
      </dl>

      <ShiftReportView report={shift.report} openingFloatCents={shift.opening_float_cents} countedCashCents={shift.counted_cash_cents} />

      <section ref={printRef} aria-label="Print" className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          {closed ? (
            <Button
              variant="outline"
              disabled={printing.starting}
              onClick={printRead}
            >
              <PrinterIcon aria-hidden="true" />
              Reprint Z-read
            </Button>
          ) : canPrintX ? (
            <Button
              variant="outline"
              disabled={printing.starting}
              onClick={printRead}
            >
              <PrinterIcon aria-hidden="true" />
              Print X-read
            </Button>
          ) : null}
        </div>
        <PrintJobList tracker={printing.tracker} notices={printing.notices} title="Print status" />
      </section>
    </div>
  );
}
