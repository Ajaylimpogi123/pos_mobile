/**
 * The status board (Table Management §D; `report.view`; polled every 15 s):
 * - stat cards from `GET /tables/summary`: Occupied `7 / 18`, Guests seated,
 *   **Pending payments** (`₱12,450.00 · 7 bills`, before discounts and
 *   service charge) and the Oldest bill (`Table 5 · 2 h 10 min`);
 * - a table list from `GET /tables`: table and area, status, guests, opened
 *   by, time open (amber after 90 minutes), time since the last round and the
 *   unpaid amount. It sorts by any column (the server returns every active
 *   table; it starts with the oldest bill first) and has an **Unpaid only**
 *   filter. With `sale.create`, a row with a bill opens it on the POS;
 * - today's upcoming (booked) reservations by time.
 * Money is the server's figures only; nothing is totalled here.
 */
import { ArmchairIcon, ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, CalendarClockIcon, HourglassIcon, UsersIcon, WalletIcon, WifiOffIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Banner } from '@/components/common/Banner';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { StatCard } from '@/components/common/StatCard';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { useBranchDay } from '@/hooks/useBranchDay';
import { useDineIn, useTablesSummary, useTablesView } from '@/hooks/useDiningTables';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { useBranchClock, useReservationList } from '@/hooks/useReservations';
import { cn } from '@/lib/utils';
import { getErrorMessage, isApiError } from '@/services/api';
import type { TableView } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { BOARD_DINE_IN_OFF, formatElapsed, LONG_TABLE_MINUTES, minutesSince, TABLES_OFFLINE_MESSAGE } from '@/utils/tables';
import { formatPeso } from '@pos/core/money';
import { tableStatus, type TableStatus } from '@pos/core/tables/status';

import { ReservationStatusBadges } from './ReservationsPanel';

const column = dataTableColumns<TableView>();

type SortKey = 'table' | 'status' | 'guests' | 'openedBy' | 'open' | 'lastRound' | 'unpaid';
type Sort = { key: SortKey; desc: boolean };

/** §D: starts sorted by time open, oldest first. */
const DEFAULT_SORT: Sort = { key: 'open', desc: true };

const STATUS_ORDER: Record<TableStatus, number> = { occupied: 0, reserved: 1, free: 2 };
const STATUS_BADGE: Record<TableStatus, { tone: 'success' | 'info' | 'warning'; label: string }> = {
  free: { tone: 'info', label: 'Free' },
  occupied: { tone: 'success', label: 'Occupied' },
  reserved: { tone: 'warning', label: 'Reserved' },
};

/** The value a column sorts by; `null` sorts last in both directions. */
function sortValue(table: TableView, key: SortKey, now: number): number | string | null {
  const tab = table.tab;
  switch (key) {
    case 'table':
      return table.name;
    case 'status':
      return STATUS_ORDER[tableStatus(table)];
    case 'guests':
      return tab ? tab.guests : null;
    case 'openedBy':
      return tab ? tab.opened_by.name : null;
    case 'open':
      return tab ? minutesSince(tab.opened_at, now) : null;
    case 'lastRound':
      return tab?.last_round_at ? minutesSince(tab.last_round_at, now) : null;
    case 'unpaid':
      return tab ? tab.remaining_cents : null;
  }
}

function compareTables(a: TableView, b: TableView, sort: Sort, now: number): number {
  const left = sortValue(a, sort.key, now);
  const right = sortValue(b, sort.key, now);
  if (left === null || right === null) return left === right ? a.name.localeCompare(b.name, undefined, { numeric: true }) : left === null ? 1 : -1;
  const order =
    typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
      : Number(left) - Number(right);
  return (sort.desc ? -order : order) || a.name.localeCompare(b.name, undefined, { numeric: true });
}

export function TablesBoard() {
  const online = useOnline();
  const dineIn = useDineIn();
  const user = useSessionStore((state) => state.user);
  const navigate = useNavigate();
  const now = useNow(30_000);
  const ready = online && dineIn.enabled;
  const summary = useTablesSummary(ready);
  const list = useTablesView(ready);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const canSell = hasPermission(user, PERMISSIONS.saleCreate);

  const rows = useMemo(() => {
    const filtered = unpaidOnly ? list.items.filter((table) => table.tab !== null && table.tab.remaining_cents > 0) : list.items;
    return [...filtered].sort((a, b) => compareTables(a, b, sort, now));
  }, [list.items, unpaidOnly, sort, now]);

  if (!online) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 font-semibold" role="status">
          <WifiOffIcon className="size-5 text-warning" aria-hidden="true" />
          {TABLES_OFFLINE_MESSAGE}
        </p>
      </Card>
    );
  }
  const offByServer = isApiError(summary.error) && summary.error.status === 409;
  if ((!dineIn.loading && !dineIn.enabled) || offByServer) {
    return (
      <Banner variant="info">
        {BOARD_DINE_IN_OFF}{' '}
        {hasPermission(user, PERMISSIONS.settingsManage) ? (
          <Link to="/printers/receipt-settings" className="font-semibold underline underline-offset-4">
            Open Receipt settings
          </Link>
        ) : null}
      </Banner>
    );
  }

  function sortHeader(key: SortKey, label: string, align: 'left' | 'right' = 'left') {
    const active = sort.key === key;
    const Icon = active ? (sort.desc ? ArrowDownIcon : ArrowUpIcon) : ArrowUpDownIcon;
    return (
      <button
        type="button"
        onClick={() => setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: key === 'open' || key === 'lastRound' || key === 'unpaid' }))}
        className={cn('inline-flex items-center gap-1 rounded-md font-medium hover:text-foreground', align === 'right' && 'ml-auto', active && 'text-foreground')}
        aria-label={`Sort by ${label}${active ? (sort.desc ? ', descending' : ', ascending') : ''}`}
      >
        {label}
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    );
  }

  const columns: DataTableColumn<TableView>[] = [
    column.display({
      id: 'table',
      header: () => sortHeader('table', 'Table'),
      cell: ({ row }) => (
        <span>
          <span className="font-semibold">{row.original.name}</span>
          {row.original.area ? <span className="text-muted-foreground"> · {row.original.area}</span> : null}
        </span>
      ),
    }),
    column.display({
      id: 'status',
      header: () => sortHeader('status', 'Status'),
      cell: ({ row }) => {
        const status = tableStatus(row.original);
        return <StatusBadge tone={STATUS_BADGE[status].tone} label={STATUS_BADGE[status].label} />;
      },
    }),
    column.display({
      id: 'guests',
      header: () => sortHeader('guests', 'Guests', 'right'),
      meta: { align: 'right' },
      cell: ({ row }) => row.original.tab?.guests ?? '—',
    }),
    column.display({
      id: 'openedBy',
      header: () => sortHeader('openedBy', 'Opened by'),
      cell: ({ row }) => row.original.tab?.opened_by.name ?? '—',
    }),
    column.display({
      id: 'open',
      header: () => sortHeader('open', 'Time open', 'right'),
      meta: { align: 'right' },
      cell: ({ row }) => {
        const tab = row.original.tab;
        if (!tab) return '—';
        const minutes = minutesSince(tab.opened_at, now);
        return <span className={cn(minutes >= LONG_TABLE_MINUTES && 'font-semibold text-warning')}>{formatElapsed(minutes)}</span>;
      },
    }),
    column.display({
      id: 'lastRound',
      header: () => sortHeader('lastRound', 'Since last round', 'right'),
      meta: { align: 'right' },
      cell: ({ row }) => {
        const tab = row.original.tab;
        if (!tab) return '—';
        return tab.last_round_at ? formatElapsed(minutesSince(tab.last_round_at, now)) : <span className="text-muted-foreground">No round yet</span>;
      },
    }),
    column.display({
      id: 'unpaid',
      header: () => sortHeader('unpaid', 'Unpaid', 'right'),
      meta: { align: 'right' },
      cell: ({ row }) => (row.original.tab ? <span className="font-semibold text-green">{formatPeso(row.original.tab.remaining_cents)}</span> : '—'),
    }),
  ];

  const figures = summary.summary;
  const oldestMinutes = figures?.oldest_open ? minutesSince(figures.oldest_open.opened_at, now) : null;

  return (
    <div className="flex flex-col gap-5">
      {summary.loading ? (
        <Card>
          <LoadingRows rows={2} label="Loading the board…" />
        </Card>
      ) : summary.error ? (
        <Card>
          <ErrorState title="Couldn't load the board" message={getErrorMessage(summary.error)} onRetry={summary.reload} />
        </Card>
      ) : figures ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Occupied"
            value={`${figures.tables_occupied} / ${figures.tables_total}`}
            icon={ArmchairIcon}
            accent="orders"
            footnote={`${figures.tables_reserved} reserved · ${figures.tables_free} free`}
          />
          <StatCard label="Guests seated" value={String(figures.guests_seated)} icon={UsersIcon} accent="average" />
          <StatCard
            label="Pending payments"
            caption={`${figures.pending_bills} ${figures.pending_bills === 1 ? 'bill' : 'bills'}`}
            value={formatPeso(figures.pending_cents)}
            icon={WalletIcon}
            accent="sales"
            footnote="Before discounts and service charge"
          />
          <StatCard
            label="Oldest bill"
            value={figures.oldest_open && oldestMinutes !== null ? `Table ${figures.oldest_open.table_name} · ${formatElapsed(oldestMinutes)}` : 'None open'}
            icon={HourglassIcon}
            accent={oldestMinutes !== null && oldestMinutes >= LONG_TABLE_MINUTES ? 'stock' : 'neutral'}
          />
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold">Tables</h2>
          <div className="flex items-center gap-2">
            <Switch id="board-unpaid-only" checked={unpaidOnly} onCheckedChange={setUnpaidOnly} />
            <Label htmlFor="board-unpaid-only">Unpaid only</Label>
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={5} label="Loading tables…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the tables" message={list.error} onRetry={list.retry} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={unpaidOnly ? 'No unpaid bills' : 'No tables yet'}
            message={unpaidOnly ? 'Every open bill is paid. Turn off Unpaid only to see every table.' : 'Add the dining tables in the List tab.'}
          />
        ) : (
          <DataTable
            label="Tables by status"
            columns={columns}
            data={rows}
            getRowId={(table) => String(table.id)}
            onRowClick={
              canSell
                ? (table) => {
                    if (table.tab) void navigate(`/sell?view=tables&tab=${encodeURIComponent(table.tab.ulid)}`);
                  }
                : undefined
            }
            rowLabel={(table) =>
              table.tab
                ? `Table ${table.name}, ${table.tab.guests} guests, ${formatPeso(table.tab.remaining_cents)} unpaid${canSell ? '. Open the bill' : ''}`
                : `Table ${table.name}, ${STATUS_BADGE[tableStatus(table)].label}`
            }
          />
        )}
        {!list.loading && !list.error && list.items.length > 0 ? (
          <LoadMoreFooter
            shown={list.items.length}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            onLoadMore={list.loadMore}
            error={list.loadMoreError}
            noun="tables"
          />
        ) : null}
      </Card>

      <UpcomingReservations />
    </div>
  );
}

/** §D (TM2): today's booked reservations by time, read-only (`GET /reservations` takes `sale.create` or `report.view`, Q-051). */
function UpcomingReservations() {
  const { today } = useBranchDay();
  const clock = useBranchClock();
  const list = useReservationList(today, { status: 'booked' });
  return (
    <Card className="overflow-hidden" role="region" aria-labelledby="board-upcoming-title">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <CalendarClockIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        <h2 id="board-upcoming-title" className="text-base font-semibold">
          Upcoming reservations
        </h2>
      </div>
      {list.loading ? (
        <LoadingRows rows={3} label="Loading reservations…" />
      ) : list.error ? (
        <ErrorState title="Couldn't load the reservations" message={list.error} onRetry={list.retry} />
      ) : list.items.length === 0 ? (
        <EmptyState title="No more reservations today" message="Bookings for today show here by time." />
      ) : (
        <ul className="divide-y divide-border">
          {list.items.map((reservation) => (
            <li key={reservation.ulid} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-semibold tabular">{clock.time(reservation.reserved_for)}</span> · {reservation.guest_name} ·{' '}
                {reservation.party_size} {reservation.party_size === 1 ? 'guest' : 'guests'} · Table {reservation.table.name}
              </span>
              <ReservationStatusBadges reservation={reservation} />
            </li>
          ))}
        </ul>
      )}
      {!list.loading && !list.error && list.hasMore ? (
        <LoadMoreFooter shown={list.items.length} hasMore={list.hasMore} loading={list.loadingMore} onLoadMore={list.loadMore} error={list.loadMoreError} noun="reservations" />
      ) : null}
    </Card>
  );
}
