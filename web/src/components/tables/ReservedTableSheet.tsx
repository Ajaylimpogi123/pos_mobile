/**
 * Sell → Tables, a **reserved** table (Table Management §F): `Reserved for
 * Santos · 4 guests · 7:00 PM`, with **Seat now** (opens the bill with
 * `reservation_ulid`), **Cancel** and **No-show** (once the time has come).
 * Nobody else can open a bill on a held table (`409` from the server).
 */
import { ArmchairIcon, UserXIcon, XCircleIcon } from 'lucide-react';
import { useState } from 'react';

import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useNow } from '@/hooks/useNow';
import { useBranchClock, useReservationConflict } from '@/hooks/useReservations';
import type { Tab, TableView } from '@/services/types';

import { OpenTabDialog, type SeatingReservation } from './OpenTabDialog';
import { CancelReservationDialog, NoShowDialog, ReservationConflictDialog, type ReservationRef } from './ReservationDialogs';

type ReservedTableSheetProps = {
  table: TableView | null;
  onClose: () => void;
  onSeated: (tab: Tab) => void;
};

export function ReservedTableSheet({ table, onClose, onSeated }: ReservedTableSheetProps) {
  const clock = useBranchClock();
  const now = useNow(30_000);
  const conflict = useReservationConflict();
  const [seating, setSeating] = useState<SeatingReservation | null>(null);
  const [cancelling, setCancelling] = useState<ReservationRef | null>(null);
  const [noShow, setNoShow] = useState<ReservationRef | null>(null);
  const reservation = table?.reservation ?? null;
  const ref: ReservationRef | null =
    table && reservation
      ? {
          ulid: reservation.ulid,
          guest_name: reservation.guest_name,
          party_size: reservation.party_size,
          reserved_for: reservation.reserved_for,
          tableName: table.name,
        }
      : null;
  const due = reservation !== null && now >= Date.parse(reservation.reserved_for);

  return (
    <>
      <Sheet open={table !== null && reservation !== null} onOpenChange={(open) => (open ? null : onClose())}>
        <SheetContent className="sm:max-w-md">
          {table && reservation ? (
            <>
              <SheetHeader>
                <SheetTitle>Table {table.name} is reserved</SheetTitle>
                <SheetDescription>
                  Reserved for {reservation.guest_name} · {reservation.party_size} {reservation.party_size === 1 ? 'guest' : 'guests'} ·{' '}
                  {clock.time(reservation.reserved_for)}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 p-5">
                {reservation.is_late ? <StatusBadge tone="warning" label="Late" className="w-fit" /> : null}
                <p className="text-sm text-muted-foreground">The table is kept free for this booking. Seat the guests when they arrive.</p>
                <Button variant="green" size="xl" onClick={() => setSeating(reservation)}>
                  <ArmchairIcon aria-hidden="true" />
                  Seat now
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="lg" onClick={() => setNoShow(ref)} disabled={!due} title={due ? undefined : 'From the booking time'}>
                    <UserXIcon aria-hidden="true" />
                    No-show
                  </Button>
                  <Button variant="destructive" size="lg" onClick={() => setCancelling(ref)}>
                    <XCircleIcon aria-hidden="true" />
                    Cancel reservation
                  </Button>
                </div>
                {!due ? <p className="text-[13px] text-muted-foreground">No-show can be marked from {clock.time(reservation.reserved_for)}.</p> : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <OpenTabDialog
        table={seating && table ? table : null}
        reservation={seating}
        onClose={() => setSeating(null)}
        onOpened={(tab) => {
          setSeating(null);
          onSeated(tab);
        }}
      />
      <CancelReservationDialog reservation={cancelling} onClose={() => setCancelling(null)} onDone={onClose} onConflict={conflict.show} />
      <NoShowDialog reservation={noShow} onClose={() => setNoShow(null)} onDone={onClose} onConflict={conflict.show} />
      <ReservationConflictDialog message={conflict.message} onDismiss={conflict.dismiss} />
    </>
  );
}
