/**
 * Settings → Devices (Hardening & Pilot §C/§E), `system.manage`: the branch's
 * tablets and web terminals, active first then by code. Filters: status
 * (Active / Retired / All), platform (Tablets / Web terminals) and a search.
 * Each row shows the health chip and the unsynced count; a row opens the
 * detail with the heartbeat fields, Rename and Retire / Restore.
 */
import { ArchiveRestoreIcon, ArchiveXIcon, EllipsisIcon, PencilIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Dash, HealthBadge } from '@/components/admin/adminParts';
import { DeviceDetailSheet } from '@/components/admin/DeviceDetailSheet';
import { RenameDeviceDialog, RestoreDeviceDialog, RetireDeviceDialog } from '@/components/admin/DeviceDialogs';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminDeviceList, type DeviceStatusFilter } from '@/hooks/useAdminDevices';
import { useDetailMode } from '@/hooks/useMediaQuery';
import { useDebounced } from '@/hooks/useDebounced';
import { usePrintConfig } from '@/hooks/usePrintConfig';
import type { AdminDevice, DevicePlatform } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatAgo } from '@/utils/dates';
import { DEVICE_PLATFORM_LABELS, DEVICE_PLATFORM_NAMES, unsyncedSalesLabel } from '@pos/core/errors/health';

const column = dataTableColumns<AdminDevice>();

type PlatformTab = 'all' | DevicePlatform;

export function DevicesPage() {
  useShellHeader('Devices');
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const [status, setStatus] = useState<DeviceStatusFilter>('active');
  const [platform, setPlatform] = useState<PlatformTab>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useAdminDeviceList({ status, platform: platform === 'all' ? null : platform, search });
  const { config } = usePrintConfig();
  const printerNames = useMemo(() => new Map((config?.printers ?? []).map((printer) => [printer.id, printer.name])), [config]);

  const [selected, setSelected] = useState<AdminDevice | null>(null);
  const [renaming, setRenaming] = useState<AdminDevice | null>(null);
  const [retiring, setRetiring] = useState<AdminDevice | null>(null);
  const [restoring, setRestoring] = useState<AdminDevice | null>(null);
  /** Keeps an open detail in step with what the server returned. */
  const refreshSelected = (saved: AdminDevice) => setSelected((current) => (current && current.id === saved.id ? saved : current));

  const columns = useMemo<DataTableColumn<AdminDevice>[]>(
    () => [
      column.display({
        id: 'device',
        header: 'Device',
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold">{row.original.code}</span>
            <span className="text-[13px] text-muted-foreground">{row.original.name}</span>
          </span>
        ),
      }),
      column.display({ id: 'platform', header: 'Type', cell: ({ row }) => DEVICE_PLATFORM_NAMES[row.original.platform] }),
      column.display({ id: 'health', header: 'Health', cell: ({ row }) => <HealthBadge health={row.original.health} /> }),
      column.display({
        id: 'unsynced',
        header: 'Unsynced',
        cell: ({ row }) => {
          if (row.original.platform === 'web') return <Dash />;
          const label = unsyncedSalesLabel(row.original.heartbeat?.outbox_pending);
          return label ? <span className="font-medium text-warning">{label}</span> : <span className="text-muted-foreground">None</span>;
        },
      }),
      column.display({
        id: 'seen',
        header: 'Last seen',
        cell: ({ row }) => <span className="whitespace-nowrap">{formatAgo(row.original.last_seen_at) ?? 'Never'}</span>,
      }),
      column.display({ id: 'user', header: 'Last user', cell: ({ row }) => row.original.last_user?.name ?? <Dash /> }),
      column.display({ id: 'version', header: 'Version', cell: ({ row }) => <span className="tabular">{row.original.app_version ?? '—'}</span> }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.code}`}>
                  <EllipsisIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(row.original)}>
                  <PencilIcon aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {row.original.is_active ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setRetiring(row.original)}>
                    <ArchiveXIcon aria-hidden="true" />
                    Retire
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setRestoring(row.original)}>
                    <ArchiveRestoreIcon aria-hidden="true" />
                    Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    [],
  );

  const filtered = status !== 'active' || platform !== 'all' || search !== '';

  // MASTER §6: the device detail is a right sheet at ≥ 1280 px and a full page below.
  const detailMode = useDetailMode();
  const showPage = detailMode === 'page' && selected !== null;

  return (
    <>
      <div hidden={showPage}>
        <PageBand title="Devices">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
              <Tabs value={status} onValueChange={(value) => setStatus(value as DeviceStatusFilter)}>
                <TabsList aria-label="Status">
                  <TabsTrigger value="active">Active</TabsTrigger>
                  <TabsTrigger value="retired">Retired</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs value={platform} onValueChange={(value) => setPlatform(value as PlatformTab)}>
                <TabsList aria-label="Device type">
                  <TabsTrigger value="all">All types</TabsTrigger>
                  <TabsTrigger value="android">{DEVICE_PLATFORM_LABELS.android}</TabsTrigger>
                  <TabsTrigger value="web">{DEVICE_PLATFORM_LABELS.web}</TabsTrigger>
                </TabsList>
              </Tabs>
              <SearchField id="devices-search" label="Search devices" value={term} onChange={setTerm} placeholder="Code or name" />
            </div>
            {list.loading ? (
              <LoadingRows rows={5} label="Loading devices…" />
            ) : list.error ? (
              <ErrorState title="Couldn't load the devices" message={list.error} onRetry={list.retry} />
            ) : list.items.length === 0 ? (
              filtered ? (
                <EmptyState title="No matching devices" message="Try another status, type or search." />
              ) : (
                <EmptyState title="No devices yet" message="A tablet or web terminal appears here after someone signs in on it." />
              )
            ) : (
              <>
                <DataTable
                  label="Devices"
                  columns={columns}
                  data={list.items}
                  getRowId={(device) => String(device.id)}
                  onRowClick={setSelected}
                  rowLabel={(device) => `${device.code}, ${device.name}`}
                />
                <LoadMoreFooter
                  shown={list.items.length}
                  hasMore={list.hasMore}
                  loading={list.loadingMore}
                  onLoadMore={list.loadMore}
                  error={list.loadMoreError}
                  noun="devices"
                />
              </>
            )}
          </Card>

        </PageBand>
      </div>
      <DeviceDetailSheet
        mode={detailMode}
        device={selected}
        timezone={timezone}
        printerNames={printerNames}
        onClose={() => setSelected(null)}
        onRename={setRenaming}
        onRetire={setRetiring}
        onRestore={setRestoring}
      />
      <RenameDeviceDialog device={renaming} onClose={() => setRenaming(null)} onDone={refreshSelected} />
      <RetireDeviceDialog device={retiring} onClose={() => setRetiring(null)} onDone={refreshSelected} />
      <RestoreDeviceDialog device={restoring} onClose={() => setRestoring(null)} onDone={refreshSelected} />
    </>
  );
}
