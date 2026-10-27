/**
 * Reservations (Table Management §E/§F; `sale.create`; online only): one
 * day's reservations by time, with status chips and **Late** in amber, a
 * **New reservation** button and the row actions **Edit**, **Seat now**
 * (today only), **Cancel** and **No-show** (once the time has come). Shown as
 * the Reservations tab of the Tables page (with a date picker), and as
 * today's list in a sheet on Sell → Tables (`compact`).
 *
 * Seat now opens the bill through `POST /tabs` with `reservation_ulid`; the
 * caller then shows the bill (`onSeated`).
 */
import { ArmchairIcon, CalendarPlusIcon, PencilIcon, UserXIcon, WifiOffIcon, XCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Banner } from '@/components/common/Banner';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { RowActions } from '@/components/common/RowActions';
import { ToneBadge } from '@/components/common/ToneBadge';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranchDay } from '@/hooks/useBranchDay';
import { useDineIn } from '@/hooks/useDiningTables';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { useBranchClock, useReservationConflict, useReservationList } from '@/hooks/useReservations';
import type { Reservation, ReservationStatus, Tab } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBusinessDate } from '@/utils/dates';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { RESERVATIONS_DINE_IN_OFF, TABLES_OFFLINE_MESSAGE } from '@/utils/tables';

import { OpenTabDialog } from './OpenTabDialog';
import { CancelReservationDialog, NoShowDialog, ReservationConflictDialog, ReservationFormDialog, type ReservationRef } from './ReservationDialogs';

const column = dataTableColumns<Reservation>();

const STATUS_LABELS: Record<ReservationStatus, { label: string; tone: 'info' | 'success' | 'danger' | 'neutral' }> = {
  booked: { label: 'Booked', tone: 'info' },
  seated: { label: 'Seated', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'No-show', tone: 'danger' },
};

export function ReservationStatusBadges({ reservation }: { reservation: Pick<Reservation, 'status' | 'is_late'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ToneBadge info={STATUS_LABELS[reservation.status]} />
      {reservation.status === 'booked' && reservation.is_late ? <StatusBadge tone="warning" label="Late" /> : null}
    </span>
  );
}

function refOf(reservation: Reservation): ReservationRef {
  return {
    ulid: reservation.ulid,
    guest_name: reservation.guest_name,
    party_size: reservation.party_size,
    reserved_for: reservation.reserved_for,
    tableName: reservation.table.name,
  };
}

type ReservationsPanelProps = {
  /** The bill just opened by Seat now. */
  onSeated: (tab: Tab) => void;
  /** Today's list only (the Sell sheet): no date picker, rows instead of a table. */
  compact?: boolean;
};

export function ReservationsPanel({ onSeated, compact = false }: ReservationsPanelProps) {
  const online = useOnline();
  const dineIn = useDineIn();
  const user = useSessionStore((state) => state.user);
  const { today } = useBranchDay();
  const clock = useBranchClock();
  const now = useNow(30_000);
  const [date, setDate] = useState(today);
  const day = compact ? today : date;
  const ready = online && dineIn.enabled;
  const list = useReservationList(day, { enabled: ready });
  const conflict = useReservationConflict();
  /** `undefined`: closed; `null`: a new reservation. */
  const [editing, setEditing] = useState<Reservation | null | undefined>(undefined);
  const [seating, setSeating] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<ReservationRef | null>(null);
  const [noShow, setNoShow] = useState<ReservationRef | null>(null);

  const canSeat = (reservation: Reservation) => reservation.status === 'booked' && reservation.business_date === today;
  const canNoShow = (reservation: Reservation) => reservation.status === 'booked' && now >= Date.parse(reservation.reserved_for);

  const columns: DataTableColumn<Reservation>[] = [
    column.display({
      id: 'time',
      header: 'Time',
      cell: ({ row }) => <span className="font-semibold tabular">{clock.time(row.original.reserved_for)}</span>,
    }),
    column.display({
      id: 'guest',
      header: 'Guest',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.guest_name}</span>
          {row.original.phone ? <span className="text-[13px] text-muted-foreground tabular">{row.original.phone}</span> : null}
          {row.original.notes ? <span className="text-[13px] text-muted-foreground">{row.original.notes}</span> : null}
        </div>
      ),
    }),
    column.display({ id: 'party', header: 'Party', meta: { align: 'right' }, cell: ({ row }) => row.original.party_size }),
    column.display({
      id: 'table',
      header: 'Table',
      cell: ({ row }) => (
        <span>
          {row.original.table.name}
          {row.original.table.area ? <span className="text-muted-foreground"> · {row.original.table.area}</span> : null}
        </span>
      ),
    }),
    column.display({ id: 'status', header: 'Status', cell: ({ row }) => <ReservationStatusBadges reservation={row.original} /> }),
    column.display({
      id: 'actions',
      header: '',
      meta: { align: 'right', srLabel: 'Actions' },
      cell: ({ row }) =>
        row.original.status === 'booked' ? (
          <RowActions label={`Actions for ${row.original.guest_name}'s reservation`}>
            <ReservationMenuItems
              canSeat={canSeat(row.original)}
              canNoShow={canNoShow(row.original)}
              onEdit={() => setEditing(row.original)}
              onSeat={() => setSeating(row.original)}
              onCancel={() => setCancelling(refOf(row.original))}
              onNoShow={() => setNoShow(refOf(row.original))}
            />
          </RowActions>
        ) : null,
    }),
  ];

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
  if (!dineIn.loading && !dineIn.enabled) {
    return (
      <Banner variant="info">
        {RESERVATIONS_DINE_IN_OFF}{' '}
        {hasPermission(user, PERMISSIONS.settingsManage) ? (
          <Link to="/printers/receipt-settings" className="font-semibold underline underline-offset-4">
            Open Receipt settings
          </Link>
        ) : null}
      </Banner>
    );
  }

  const newButton = (
    <Button variant="green" size={compact ? 'default' : 'lg'} onClick={() => setEditing(null)}>
      <CalendarPlusIcon aria-hidden="true" />
      New reservation
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {compact ? (
          <p className="text-sm text-muted-foreground">{formatBusinessDate(today)}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reservations-date">Date</Label>
            <Input id="reservations-date" type="date" className="w-44 tabular" value={date} onChange={(event) => setDate(event.target.value || today)} />
          </div>
        )}
        {newButton}
      </div>

      <Card className="overflow-hidden">
        {list.loading || dineIn.loading ? (
          <LoadingRows rows={4} label="Loading reservations…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the reservations" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={day === today ? 'No reservations today' : `No reservations on ${formatBusinessDate(day)}`}
            message="Book a table for a guest with New reservation. The table is kept free shortly before the time."
          />
        ) : compact ? (
          <ul className="divide-y divide-border">
            {list.items.map((reservation) => (
              <li key={reservation.ulid} className="flex items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold">
                    <span className="tabular">{clock.time(reservation.reserved_for)}</span> · {reservation.guest_name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Table {reservation.table.name} · {reservation.party_size} {reservation.party_size === 1 ? 'guest' : 'guests'}
                  </span>
                  <ReservationStatusBadges reservation={reservation} />
                </div>
                {reservation.status === 'booked' ? (
                  <RowActions label={`Actions for ${reservation.guest_name}'s reservation`}>
                    <ReservationMenuItems
                      canSeat={canSeat(reservation)}
                      canNoShow={canNoShow(reservation)}
                      onEdit={() => setEditing(reservation)}
                      onSeat={() => setSeating(reservation)}
                      onCancel={() => setCancelling(refOf(reservation))}
                      onNoShow={() => setNoShow(refOf(reservation))}
                    />
                  </RowActions>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <DataTable
            label={`Reservations, ${formatBusinessDate(day)}`}
            columns={columns}
            data={list.items}
            getRowId={(reservation) => reservation.ulid}
            rowLabel={(reservation) =>
              `${clock.time(reservation.reserved_for)}, ${reservation.guest_name}, ${reservation.party_size} guests, table ${reservation.table.name}, ${STATUS_LABELS[reservation.status].label}`
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
            noun="reservations"
          />
        ) : null}
      </Card>

      <ReservationFormDialog
        open={editing !== undefined}
        reservation={editing ?? null}
        defaultDate={day}
        onClose={() => setEditing(undefined)}
        onConflict={conflict.show}
      />
      <CancelReservationDialog reservation={cancelling} onClose={() => setCancelling(null)} onConflict={conflict.show} />
      <NoShowDialog reservation={noShow} onClose={() => setNoShow(null)} onConflict={conflict.show} />
      <OpenTabDialog
        table={seating ? { id: seating.table.id, name: seating.table.name, area: seating.table.area, seats: null } : null}
        reservation={seating}
        onClose={() => setSeating(null)}
        onOpened={(tab) => {
          setSeating(null);
          onSeated(tab);
        }}
      />
      <ReservationConflictDialog message={conflict.message} onDismiss={conflict.dismiss} />
    </div>
  );
}

type MenuItemsProps = {
  canSeat: boolean;
  canNoShow: boolean;
  onEdit: () => void;
  onSeat: () => void;
  onCancel: () => void;
  onNoShow: () => void;
};

function ReservationMenuItems({ canSeat, canNoShow, onEdit, onSeat, onCancel, onNoShow }: MenuItemsProps) {
  return (
    <>
      {canSeat ? (
        <DropdownMenuItem onSelect={onSeat}>
          <ArmchairIcon aria-hidden="true" />
          Seat now
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={onEdit}>
        <PencilIcon aria-hidden="true" />
        Edit
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onNoShow} disabled={!canNoShow}>
        <UserXIcon aria-hidden="true" />
        {canNoShow ? 'No-show' : 'No-show (from the booking time)'}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onCancel}>
        <XCircleIcon aria-hidden="true" />
        Cancel
      </DropdownMenuItem>
    </>
  );
}
