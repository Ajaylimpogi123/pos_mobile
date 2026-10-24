/**
 * The shift history (`report.zread`; back-office.md list page): status tabs,
 * the business-day and terminal filters (`business_date`, `status`,
 * `device_id`, all sent to `GET /shifts`), the table, and the cursor
 * "Load more". A row (click or Enter), or its ⋯ menu, calls `onOpen` (the page shows the detail).
 *
 * The terminal filter offers this terminal and every terminal seen in the
 * loaded rows: there is no device list a `report.zread` user may read.
 */
import { EllipsisIcon, EyeIcon, PrinterIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useShiftList } from '@/hooks/useShifts';
import type { Shift, ShiftDevice, ShiftStatus } from '@/services/types';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { varianceWord } from '@pos/core/printing/documents/shiftRead';

import type { ShiftDetailIntent } from './ShiftDetailSheet';
import { ShiftFlagBadges, ShiftStatusBadge } from './ShiftStatus';

const STATUS_TABS: { value: ShiftStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const column = dataTableColumns<Shift>();

function varianceText(cents: number): string {
  return cents === 0 ? varianceWord(cents) : `${varianceWord(cents)} ${formatPeso(Math.abs(cents))}`;
}

type ShiftHistoryProps = {
  today: string;
  /** Opens a shift's detail (the page shows it as a sheet or a full page). */
  onOpen: (ulid: string, intent: ShiftDetailIntent) => void;
};

export function ShiftHistory({ today, onOpen }: ShiftHistoryProps) {
  const user = useSessionStore((state) => state.user);
  const device = registeredDevice(useSessionStore((state) => state.device));
  const timezone = user?.branch.timezone ?? 'Asia/Manila';

  const [status, setStatus] = useState<ShiftStatus | 'all'>('all');
  const [businessDate, setBusinessDate] = useState(today);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const canPrintX = hasPermission(user, PERMISSIONS.shiftOpen);

  const list = useShiftList({ businessDate: businessDate || null, status: status === 'all' ? null : status, deviceId });

  // The terminals the filter can offer: this one, the chosen one, and those in the loaded rows.
  const [seen, setSeen] = useState<ShiftDevice[]>([]);
  const terminals = useMemo(() => {
    const byId = new Map<number, ShiftDevice>();
    if (device) byId.set(device.id, { id: device.id, code: device.code });
    for (const entry of seen) byId.set(entry.id, entry);
    for (const shift of list.items) byId.set(shift.device.id, shift.device);
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [device, seen, list.items]);

  const columns = useMemo<DataTableColumn<Shift>[]>(
    () => [
      column.display({
        id: 'terminal',
        header: 'Terminal',
        cell: ({ row }) => <span className="font-medium">{row.original.device.code}</span>,
      }),
      column.display({
        id: 'opened',
        header: 'Opened',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="whitespace-nowrap">{formatBranchDateTime(row.original.opened_at, timezone) ?? row.original.opened_at}</span>
            <span className="text-[13px] text-muted-foreground">{row.original.opened_by.name}</span>
          </div>
        ),
      }),
      column.display({
        id: 'closed',
        header: 'Closed',
        cell: ({ row }) =>
          row.original.closed_at ? (
            <div className="flex flex-col">
              <span className="whitespace-nowrap">{formatBranchDateTime(row.original.closed_at, timezone) ?? row.original.closed_at}</span>
              <span className="text-[13px] text-muted-foreground">{row.original.closed_by?.name ?? ''}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">Still open</span>
          ),
      }),
      column.display({
        id: 'net',
        header: 'Net sales',
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold">{formatPeso(row.original.report.net_sales_cents)}</span>,
      }),
      column.display({
        id: 'expected',
        header: 'Expected cash',
        meta: { align: 'right' },
        cell: ({ row }) => formatPeso(row.original.report.expected_cash_cents),
      }),
      column.display({
        id: 'counted',
        header: 'Counted',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const { counted_cash_cents: counted, report } = row.original;
          if (counted === null) return <span className="text-muted-foreground">—</span>;
          const variance = report.variance_cents;
          return (
            <span className="flex flex-col items-end">
              <span>{formatPeso(counted)}</span>
              {variance !== null ? (
                <span className={variance < 0 ? 'text-[13px] text-danger' : variance > 0 ? 'text-[13px] text-warning' : 'text-[13px] text-success'}>
                  {varianceText(variance)}
                </span>
              ) : null}
            </span>
          );
        },
      }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <ShiftStatusBadge status={row.original.status} />
            <ShiftFlagBadges flags={row.original.flags} />
          </div>
        ),
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => {
          const shift = row.original;
          const closed = shift.status === 'closed';
          return (
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for the shift of ${shift.device.code}`}>
                    <EllipsisIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onOpen(shift.ulid, 'view')}>
                    <EyeIcon aria-hidden="true" />
                    View
                  </DropdownMenuItem>
                  {closed || canPrintX ? (
                    <DropdownMenuItem onSelect={() => onOpen(shift.ulid, 'print')}>
                      <PrinterIcon aria-hidden="true" />
                      {closed ? 'Reprint Z-read' : 'Print X-read'}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [timezone, onOpen, canPrintX],
  );

  const filtered = status !== 'all' || deviceId !== null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <h2 className="text-lg font-bold">Shift history</h2>
        <Tabs value={status} onValueChange={(value) => setStatus(value as ShiftStatus | 'all')}>
          <TabsList aria-label="Shift status">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shifts-date">Business day</Label>
            <div className="flex gap-2">
              <Input
                id="shifts-date"
                type="date"
                value={businessDate}
                max={today || undefined}
                onChange={(event) => setBusinessDate(event.target.value)}
                className="w-44"
              />
              {businessDate ? (
                <Button variant="outline" onClick={() => setBusinessDate('')}>
                  All days
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setBusinessDate(today)}>
                  Today
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shifts-terminal">Terminal</Label>
            <select
              id="shifts-terminal"
              value={deviceId === null ? '' : String(deviceId)}
              onChange={(event) => {
                // Keep every terminal offered so far, so filtering by one doesn't hide the others.
                setSeen(terminals);
                setDeviceId(event.target.value === '' ? null : Number(event.target.value));
              }}
              className="h-10 w-48 rounded-lg border border-input bg-card px-3 text-[15px] shadow-card"
            >
              <option value="">All terminals</option>
              {terminals.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code}
                  {device && entry.id === device.id ? ' (this terminal)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {list.loading ? (
        <LoadingRows rows={5} label="Loading shifts…" />
      ) : list.error ? (
        <ErrorState title="Couldn't load the shifts" message={list.error} onRetry={list.retry} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title="No shifts found"
          message={
            filtered
              ? 'No shift matches these filters. Pick another status or terminal.'
              : businessDate
                ? 'No shift on this business day. Pick another day, or show all days.'
                : 'Shifts appear here once a terminal opens one.'
          }
        />
      ) : (
        <>
          <DataTable
            label="Shifts"
            columns={columns}
            data={list.items}
            getRowId={(shift) => shift.ulid}
            onRowClick={(shift) => onOpen(shift.ulid, 'view')}
            rowLabel={(shift) => `Terminal ${shift.device.code}, opened ${formatBranchDateTime(shift.opened_at, timezone) ?? shift.opened_at}`}
          />
          <LoadMoreFooter
            shown={list.items.length}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            onLoadMore={list.loadMore}
            error={list.loadMoreError}
            noun="shifts"
          />
        </>
      )}
    </Card>
  );
}
