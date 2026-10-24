/**
 * Admin Devices → a device's detail (Hardening & Pilot §C/§E): its health,
 * last user, version and the fields of its last heartbeat, with Rename and
 * Retire / Restore. Web terminals have no outbox, so those rows are left out.
 */
import { ArchiveRestoreIcon, ArchiveXIcon, PencilIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Dash, DetailGrid, DetailItem, HealthBadge } from '@/components/admin/adminParts';
import { DetailPanel } from '@/components/common/DetailPanel';
import { Button } from '@/components/ui/button';
import type { AdminDevice, DeviceHeartbeat } from '@/services/types';
import { formatAgo } from '@/utils/dates';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { DEVICE_HEALTH_DESCRIPTIONS, DEVICE_PLATFORM_NAMES, unsyncedSalesLabel } from '@pos/core/errors/health';
import { formatCount } from '@pos/core/numbers';

type Props = {
  device: AdminDevice | null;
  /** `sheet` at ≥ 1280 px, `page` below (MASTER §6, `useDetailMode`). */
  mode: 'sheet' | 'page';
  timezone: string;
  /** Printer names by id (from the print config), for the heartbeat's printer list. */
  printerNames: ReadonlyMap<number, string>;
  onClose: () => void;
  onRename: (device: AdminDevice) => void;
  onRetire: (device: AdminDevice) => void;
  onRestore: (device: AdminDevice) => void;
};

export function DeviceDetailSheet({ device, mode, timezone, printerNames, onClose, onRename, onRetire, onRestore }: Props) {
  return (
    <DetailPanel
      mode={mode}
      open={device !== null}
      onClose={onClose}
      sheetClassName="sm:max-w-2xl"
      backLabel="Back to devices"
      title={device ? `${device.code} · ${device.name}` : 'Device'}
      description={device ? DEVICE_PLATFORM_NAMES[device.platform] : null}
    >
        {device ? (
          <>
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <HealthBadge health={device.health} />
                <p className="text-sm text-muted-foreground">{DEVICE_HEALTH_DESCRIPTIONS[device.health]}</p>
              </div>
              <DeviceSummary device={device} timezone={timezone} />
              <section className="flex flex-col gap-2" aria-labelledby="device-heartbeat-title">
                <h3 id="device-heartbeat-title" className="font-semibold">
                  Last heartbeat
                </h3>
                {device.heartbeat ? (
                  <HeartbeatDetails
                    heartbeat={device.heartbeat}
                    at={device.heartbeat_at}
                    timezone={timezone}
                    tablet={device.platform === 'android'}
                    printerNames={printerNames}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No heartbeat received from this device yet.</p>
                )}
              </section>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onRename(device)}>
                  <PencilIcon aria-hidden="true" />
                  Rename
                </Button>
                {device.is_active ? (
                  <Button variant="destructive" onClick={() => onRetire(device)}>
                    <ArchiveXIcon aria-hidden="true" />
                    Retire
                  </Button>
                ) : (
                  <Button variant="green" onClick={() => onRestore(device)}>
                    <ArchiveRestoreIcon aria-hidden="true" />
                    Restore
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : null}
    </DetailPanel>
  );
}

function when(iso: string | null, timezone: string): ReactNode {
  if (!iso) return <Dash />;
  const ago = formatAgo(iso);
  return (
    <span>
      {formatBranchDateTime(iso, timezone) ?? iso}
      {ago ? <span className="text-muted-foreground"> · {ago}</span> : null}
    </span>
  );
}

function DeviceSummary({ device, timezone }: { device: AdminDevice; timezone: string }) {
  return (
    <DetailGrid>
      <DetailItem label="Last seen">{when(device.last_seen_at, timezone)}</DetailItem>
      <DetailItem label="Last user">{device.last_user?.name ?? <Dash />}</DetailItem>
      <DetailItem label="App version">{device.app_version ?? <Dash />}</DetailItem>
      <DetailItem label="Status">{device.is_active ? 'Active' : 'Retired'}</DetailItem>
      {device.retired_at ? <DetailItem label="Retired">{when(device.retired_at, timezone)}</DetailItem> : null}
    </DetailGrid>
  );
}

function count(value: number | null): ReactNode {
  return value === null ? <Dash /> : <span className="tabular">{formatCount(value)}</span>;
}

type HeartbeatProps = {
  heartbeat: DeviceHeartbeat;
  at: string | null;
  timezone: string;
  tablet: boolean;
  printerNames: ReadonlyMap<number, string>;
};

function HeartbeatDetails({ heartbeat, at, timezone, tablet, printerNames }: HeartbeatProps) {
  return (
    <>
      <DetailGrid>
        <DetailItem label="Received">{when(at, timezone)}</DetailItem>
        <DetailItem label={tablet ? 'OS version' : 'Browser'}>{heartbeat.os_version ?? <Dash />}</DetailItem>
        {tablet ? <DetailItem label="Model">{heartbeat.device_model ?? <Dash />}</DetailItem> : null}
        {tablet ? (
          <>
            <DetailItem label="Unsynced sales">
              {unsyncedSalesLabel(heartbeat.outbox_pending) ?? (heartbeat.outbox_pending === null ? <Dash /> : 'None')}
            </DetailItem>
            <DetailItem label="Failed sales">{count(heartbeat.outbox_failed)}</DetailItem>
            <DetailItem label="Oldest unsynced sale">{when(heartbeat.oldest_pending_at, timezone)}</DetailItem>
            <DetailItem label="Menu synced">{when(heartbeat.last_catalogue_sync_at, timezone)}</DetailItem>
            <DetailItem label="Stock synced">{when(heartbeat.last_stock_sync_at, timezone)}</DetailItem>
            <DetailItem label="Free storage">
              {heartbeat.storage_free_mb === null ? <Dash /> : <span className="tabular">{formatCount(heartbeat.storage_free_mb)} MB</span>}
            </DetailItem>
          </>
        ) : null}
        <DetailItem label="Error reports waiting">{count(heartbeat.errors_pending)}</DetailItem>
      </DetailGrid>
      <h4 className="mt-2 text-sm font-semibold">Printers</h4>
      {heartbeat.printers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No printer status reported.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {heartbeat.printers.map((printer) => (
            <li key={printer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span>{printerNames.get(printer.id) ?? `Printer #${printer.id}`}</span>
              <span className={printer.ok ? 'font-medium text-success' : 'font-medium text-danger'}>
                {printer.ok ? 'Last print OK' : 'Last print failed'}
                <span className="font-normal text-muted-foreground"> · {formatAgo(printer.checked_at) ?? printer.checked_at}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
