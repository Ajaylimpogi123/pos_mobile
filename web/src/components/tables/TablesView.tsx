/**
 * The Tables view (Dine-in Tables & Tabs §C/§I; Table Management §C/§F): the
 * branch's active tables grouped by area. A table shows its name, its status
 * (Free, Occupied or Reserved, from the shared `tableStatus`), the guests,
 * the remaining amount and the time since the bill opened (amber after 90
 * minutes); an occupied table with a held reservation also shows
 * `Reserved 7:00 PM`.
 *
 * - **Floor | Grid:** an area with at least one placed table shows its floor
 *   plan (scaled to the width), with its unplaced tables as cards below; the
 *   choice is remembered per browser. Grid is the v1.26 card grid.
 * - A free table opens a bill (asking for guests); an occupied one opens its
 *   bill; a reserved one opens a sheet with **Seat now**, **Cancel** and **No-show**.
 * - **Reservations** opens today's list.
 * - Polled every 15 s while shown, and after every tab action. Offline:
 *   "Tables need a connection." and no actions.
 */
import { CalendarDaysIcon, ClockIcon, UsersIcon, WifiOffIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { Segmented } from '@/components/sell/SellParts';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTablesView } from '@/hooks/useDiningTables';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { useBranchClock } from '@/hooks/useReservations';
import { cn } from '@/lib/utils';
import type { Tab, TableView } from '@/services/types';
import {
  formatElapsed,
  groupByArea,
  LONG_TABLE_MINUTES,
  minutesSince,
  NO_AREA_LABEL,
  readTablesViewMode,
  TABLES_OFFLINE_MESSAGE,
  writeTablesViewMode,
  type TablesViewMode,
} from '@/utils/tables';
import { formatPeso } from '@pos/core/money';
import { isPlaced } from '@pos/core/tables/floorPlan';
import { tableStatus, type TableStatus } from '@pos/core/tables/status';

import { FloorGrid, FloorSlot } from './FloorPlan';
import { shapeClass } from './floorPlanStyles';
import { OpenTabDialog } from './OpenTabDialog';
import { ReservationsPanel } from './ReservationsPanel';
import { ReservedTableSheet } from './ReservedTableSheet';

const STATUS_BADGE: Record<TableStatus, { tone: 'success' | 'info' | 'warning'; label: string }> = {
  free: { tone: 'info', label: 'Free' },
  occupied: { tone: 'success', label: 'Occupied' },
  reserved: { tone: 'warning', label: 'Reserved' },
};

/** The tile colours by status (cards and floor tables alike). */
const STATUS_SURFACE: Record<TableStatus, string> = {
  free: 'border-border bg-card',
  occupied: 'border-green-line bg-green-soft',
  reserved: 'border-warning-border bg-warning-bg',
};

export function TablesView({ onOpenTab }: { onOpenTab: (ulid: string) => void }) {
  const online = useOnline();
  const list = useTablesView(online);
  const now = useNow(30_000);
  const clock = useBranchClock();
  const [opening, setOpening] = useState<TableView | null>(null);
  const [reserved, setReserved] = useState<TableView | null>(null);
  const [showReservations, setShowReservations] = useState(false);
  const [mode, setMode] = useState<TablesViewMode>(() => readTablesViewMode());
  const groups = useMemo(() => groupByArea(list.items), [list.items]);
  const anyPlaced = useMemo(() => list.items.some((table) => isPlaced(table)), [list.items]);

  function chooseMode(next: TablesViewMode) {
    setMode(next);
    writeTablesViewMode(next);
  }

  function select(table: TableView) {
    const status = tableStatus(table);
    if (status === 'occupied' && table.tab) onOpenTab(table.tab.ulid);
    else if (status === 'reserved') setReserved(table);
    else setOpening(table);
  }

  if (!online) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 font-semibold" role="status">
          <WifiOffIcon className="size-5 text-warning" aria-hidden="true" />
          {TABLES_OFFLINE_MESSAGE}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Pay now still works. The tables come back when this computer is online.</p>
      </Card>
    );
  }

  const toolbar = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      {anyPlaced ? (
        <Segmented
          label="Tables layout"
          value={mode}
          options={[
            { value: 'floor', label: 'Floor' },
            { value: 'grid', label: 'Grid' },
          ]}
          onChange={chooseMode}
        />
      ) : (
        <span />
      )}
      <Button variant="outline" size="lg" onClick={() => setShowReservations(true)}>
        <CalendarDaysIcon aria-hidden="true" />
        Reservations
      </Button>
    </div>
  );

  let body: ReactNode;
  if (list.loading) {
    body = (
      <Card>
        <LoadingRows rows={4} label="Loading tables…" />
      </Card>
    );
  } else if (list.error) {
    body = (
      <Card>
        <ErrorState title="Couldn't load the tables" message={list.error} onRetry={list.retry} />
      </Card>
    );
  } else if (list.items.length === 0) {
    body = (
      <Card>
        <EmptyState title="No tables yet" message="A manager adds the dining tables under Tables in the menu (or from Receipt settings → Dine-in)." />
      </Card>
    );
  } else {
    body = (
      <>
        {groups.map((group) => {
          const placed = group.tables.filter((table) => isPlaced(table));
          const floor = mode === 'floor' && placed.length > 0;
          const cards = floor ? group.tables.filter((table) => !isPlaced(table)) : group.tables;
          const areaName = group.area ?? NO_AREA_LABEL;
          return (
            <section key={group.key} aria-labelledby={`area-${group.key}`} className="flex flex-col gap-3">
              <h2 id={`area-${group.key}`} className="text-base font-semibold">
                {areaName}
              </h2>
              {floor ? (
                <Card className="p-3">
                  <FloorGrid label={`Floor plan, ${areaName}`}>
                    {placed.map((table) => (
                      <FloorSlot key={table.id} rect={{ pos_x: table.pos_x ?? 0, pos_y: table.pos_y ?? 0, width: table.width, height: table.height }}>
                        <FloorTable table={table} now={now} timeOf={clock.time} onSelect={() => select(table)} />
                      </FloorSlot>
                    ))}
                  </FloorGrid>
                </Card>
              ) : null}
              {cards.length > 0 ? (
                <>
                  {floor ? <p className="text-sm text-muted-foreground">Not on the plan</p> : null}
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                    {cards.map((table) => (
                      <li key={table.id}>
                        <TableCard table={table} now={now} timeOf={clock.time} onSelect={() => select(table)} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          );
        })}
        <LoadMoreFooter
          shown={list.items.length}
          hasMore={list.hasMore}
          loading={list.loadingMore}
          onLoadMore={list.loadMore}
          error={list.loadMoreError}
          noun="tables"
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {toolbar}
      {body}
      <OpenTabDialog
        table={opening}
        onClose={() => setOpening(null)}
        onOpened={(tab: Tab) => {
          setOpening(null);
          onOpenTab(tab.ulid);
        }}
      />
      <ReservedTableSheet
        table={reserved}
        onClose={() => setReserved(null)}
        onSeated={(tab) => {
          setReserved(null);
          onOpenTab(tab.ulid);
        }}
      />
      <Sheet open={showReservations} onOpenChange={setShowReservations}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Reservations</SheetTitle>
            <SheetDescription>Today's bookings by time.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
            {showReservations ? (
              <ReservationsPanel
                compact
                onSeated={(tab) => {
                  setShowReservations(false);
                  onOpenTab(tab.ulid);
                }}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

type TileProps = { table: TableView; now: number; timeOf: (iso: string) => string; onSelect: () => void };

/** What a table shows, shared by the card and the floor tile. */
function describe(table: TableView, now: number, timeOf: (iso: string) => string) {
  const status = tableStatus(table);
  const tab = table.tab;
  const minutes = tab ? minutesSince(tab.opened_at, now) : 0;
  const long = tab !== null && minutes >= LONG_TABLE_MINUTES;
  const reservation = table.reservation;
  // An occupied table with a held reservation; a free table's later booking today.
  const reservedBadge = reservation && status === 'occupied' && reservation.is_held ? `Reserved ${timeOf(reservation.reserved_for)}` : null;
  const reservedLine =
    reservation && status === 'reserved'
      ? `${reservation.guest_name} · ${reservation.party_size} · ${timeOf(reservation.reserved_for)}`
      : reservation && status === 'free'
        ? `Booked ${timeOf(reservation.reserved_for)}`
        : null;
  const label = tab
    ? `Table ${table.name}, occupied, ${tab.guests} guests, ${formatPeso(tab.remaining_cents)}, open ${formatElapsed(minutes)}${reservedBadge ? `, ${reservedBadge}` : ''}`
    : status === 'reserved' && reservation
      ? `Table ${table.name}, reserved for ${reservation.guest_name}, ${reservation.party_size} guests at ${timeOf(reservation.reserved_for)}${reservation.is_late ? ', late' : ''}`
      : `Table ${table.name}, free, ${table.seats} seats${reservedLine ? `, ${reservedLine}` : ''}. Open a bill`;
  return { status, tab, minutes, long, reservation, reservedBadge, reservedLine, label };
}

function TableCard({ table, now, timeOf, onSelect }: TileProps) {
  const info = describe(table, now, timeOf);
  const { tab } = info;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={info.label}
      className={cn(
        'flex h-full min-h-32 w-full flex-col gap-2 rounded-xl border p-4 text-left shadow-card transition-colors hover:border-green-line',
        STATUS_SURFACE[info.status],
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold">{table.name}</span>
        <StatusBadge tone={STATUS_BADGE[info.status].tone} label={STATUS_BADGE[info.status].label} />
      </div>
      {info.reservedBadge ? <StatusBadge tone="warning" label={info.reservedBadge} className="w-fit" /> : null}
      {tab ? (
        <>
          <span className="flex items-center gap-1.5 text-sm">
            <UsersIcon className="size-4" aria-hidden="true" />
            {tab.guests} {tab.guests === 1 ? 'guest' : 'guests'} · {tab.item_count} {tab.item_count === 1 ? 'item' : 'items'}
          </span>
          <span className="text-lg font-bold text-green tabular">{formatPeso(tab.remaining_cents)}</span>
          <span className={cn('flex items-center gap-1.5 text-sm', info.long ? 'font-semibold text-warning' : 'text-muted-foreground')}>
            <ClockIcon className="size-4" aria-hidden="true" />
            {formatElapsed(info.minutes)}
          </span>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <UsersIcon className="size-4" aria-hidden="true" />
            {table.seats} {table.seats === 1 ? 'seat' : 'seats'}
          </span>
          {info.reservedLine ? (
            <span className={cn('flex items-center gap-1.5 text-sm', info.status === 'reserved' ? 'font-semibold text-warning' : 'text-muted-foreground')}>
              <CalendarDaysIcon className="size-4" aria-hidden="true" />
              {info.reservedLine}
            </span>
          ) : null}
          {info.status === 'reserved' && info.reservation?.is_late ? <StatusBadge tone="warning" label="Late" className="w-fit" /> : null}
        </>
      )}
    </button>
  );
}

/** A table drawn on the floor plan: the same colours and contents as the card, trimmed to its size. */
function FloorTable({ table, now, timeOf, onSelect }: TileProps) {
  const info = describe(table, now, timeOf);
  const { tab } = info;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={info.label}
      title={info.label}
      className={cn(
        '@container flex size-full flex-col items-center justify-center gap-0.5 overflow-hidden border p-1 text-center shadow-card transition-colors hover:border-green-line',
        shapeClass(table.shape),
        STATUS_SURFACE[info.status],
      )}
    >
      <span className="text-sm leading-tight font-bold @min-[90px]:text-lg">{table.name}</span>
      <span className="hidden text-xs leading-tight font-semibold @min-[64px]:block">{STATUS_BADGE[info.status].label}</span>
      {info.reservedBadge ? (
        <span className="hidden text-xs leading-tight font-semibold text-warning @min-[100px]:block">{info.reservedBadge}</span>
      ) : null}
      {tab ? (
        <>
          <span className="hidden text-xs leading-tight font-bold text-green tabular @min-[80px]:block">{formatPeso(tab.remaining_cents)}</span>
          <span
            className={cn(
              'hidden text-xs leading-tight @min-[100px]:block',
              info.long ? 'font-semibold text-warning' : 'text-muted-foreground',
            )}
          >
            {tab.guests} {tab.guests === 1 ? 'guest' : 'guests'} · {formatElapsed(info.minutes)}
          </span>
        </>
      ) : info.reservedLine ? (
        <span className="hidden text-xs leading-tight text-muted-foreground @min-[100px]:block">{info.reservedLine}</span>
      ) : null}
    </button>
  );
}
