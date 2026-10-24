/**
 * POS: the terminal's registration, then its shift (the open-shift gate),
 * then the Sell screen. Logic lives in the hooks; this page only arranges them.
 * Dine-in Tables & Tabs §I: while dine-in is on, a **Pay now | Tables**
 * switch sits at the top (`?view=tables`, `&tab=<ulid>` for an open bill);
 * Pay now is today's screen, unchanged.
 */
import { ClockIcon, LoaderCircleIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Banner } from '@/components/common/Banner';
import { ErrorState } from '@/components/common/ListStates';
import { ReceiptPrinterPicker } from '@/components/printing/ReceiptPrinterPicker';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { OpenShiftCard } from '@/components/sell/OpenShiftCard';
import { SellScreen } from '@/components/sell/SellScreen';
import { Segmented } from '@/components/sell/SellParts';
import { TabScreen } from '@/components/tables/TabScreen';
import { TablesView } from '@/components/tables/TablesView';
import { useDineIn } from '@/hooks/useDiningTables';
import { Card } from '@/components/ui/card';
import { registerTerminal } from '@/hooks/useAuth';
import { useCurrentShift } from '@/hooks/useCurrentShift';
import { canUseModule } from '@/hooks/useModules';
import { moduleByKey } from '@/constants/modules';
import { usePrintConfig, useReceiptPrinter } from '@/hooks/usePrintConfig';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { useTerminalStore } from '@/stores/terminal';
import { formatBranchTime } from '@pos/core/businessDay';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

export function SellPage() {
  const user = useSessionStore((state) => state.user);
  const deviceState = useSessionStore((state) => state.device);
  const device = registeredDevice(deviceState);
  const current = useCurrentShift();
  const { config } = usePrintConfig();
  const receiptPrinter = useReceiptPrinter(config);
  const gateNotice = useTerminalStore((state) => state.gateNotice);
  const dineIn = useDineIn();
  const [params, setParams] = useSearchParams();
  const tablesMode = dineIn.enabled && params.get('view') === 'tables';
  const tabUlid = tablesMode ? params.get('tab') : null;

  function showTables(tab: string | null = null) {
    setParams(tab ? { view: 'tables', tab } : { view: 'tables' });
  }

  const shiftsModule = canUseModule(user, moduleByKey('shifts')) ? moduleByKey('shifts') : null;
  const shiftSince = current.shift && user ? formatBranchTime(current.shift.opened_at, user.branch.timezone) : null;
  const status = useMemo(
    () => (
      <>
        {shiftSince ? (
          shiftsModule ? (
            // Cash in/out, the X-read and Close shift live on the Shifts page.
            <Link
              to={shiftsModule.path}
              className="hidden items-center gap-1.5 rounded-md px-1 underline-offset-4 hover:underline sm:flex"
              title="Cash in, cash out, X-read and close shift"
            >
              <ClockIcon className="size-4" aria-hidden="true" />
              Shift since {shiftSince}
            </Link>
          ) : (
            <span className="hidden items-center gap-1.5 sm:flex">
              <ClockIcon className="size-4" aria-hidden="true" />
              Shift since {shiftSince}
            </span>
          )
        ) : null}
        {device ? <span className="hidden md:inline">Terminal {device.code}</span> : null}
        <ReceiptPrinterPicker choice={receiptPrinter} compact />
      </>
    ),
    [shiftSince, shiftsModule, device, receiptPrinter],
  );
  useShellHeader('POS', status);

  if (deviceState.status === 'failed') {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <ErrorState
            title="This terminal isn't set up yet"
            message={`${deviceState.message} Sales and printing need a registered terminal.`}
            onRetry={() => void registerTerminal()}
          />
        </Card>
      </div>
    );
  }
  if (!device || current.loading) {
    return (
      <p className="flex items-center gap-2 p-6 text-muted-foreground" aria-live="polite">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        {device ? "Checking this terminal's shift…" : 'Setting up this terminal…'}
      </p>
    );
  }
  if (current.error) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <ErrorState title="Couldn't read the shift" message={current.error} onRetry={current.reload} />
        </Card>
      </div>
    );
  }
  if (!current.shift) {
    return <OpenShiftCard canOpen={hasPermission(user, PERMISSIONS.shiftOpen)} notice={gateNotice} />;
  }
  return (
    <>
      {config && receiptPrinter.options.length === 0 ? (
        <div className="px-4 pt-4 md:px-6">
          <Banner variant="warning">
            No receipt printer is set up for this terminal. Sales still go through; receipts can be reprinted from Order History once
            one is added.
          </Banner>
        </div>
      ) : null}
      {dineIn.enabled ? (
        <div className="px-4 pt-4 md:px-6">
          <Segmented
            label="Sell mode"
            value={tablesMode ? 'tables' : 'now'}
            options={[
              { value: 'now', label: 'Pay now' },
              { value: 'tables', label: 'Tables' },
            ]}
            onChange={(value) => (value === 'tables' ? showTables() : setParams({}))}
          />
        </div>
      ) : null}
      {tablesMode ? (
        <div className="p-4 md:p-6">
          {tabUlid ? (
            <TabScreen key={tabUlid} tabUlid={tabUlid} shift={current.shift} onBack={() => showTables()} onOpenTab={(ulid) => showTables(ulid)} />
          ) : (
            <TablesView onOpenTab={(ulid) => showTables(ulid)} />
          )}
        </div>
      ) : (
        <SellScreen shift={current.shift} />
      )}
    </>
  );
}
