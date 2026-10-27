/**
 * Reservation dialogs (Table Management §E/§F; `sale.create`; online only):
 * - **New / Edit reservation**: table, guest name, phone, party size, date,
 *   time and notes. The table picker marks tables already booked within the
 *   120-minute slot (`reservationsClash`), and a party larger than the table's
 *   seats is a warning, never a block. The date and time are the branch's
 *   wall clock, sent as an ISO instant (`reserved_for`).
 * - **Cancel** (optional reason) and **No-show** (only once the time has come).
 * - The `409` dialog ("This reservation is no longer booked."): closing it reloads.
 *
 * Every write goes through `useTabAction`: one `Idempotency-Key` per dialog,
 * reused on every retry until a 2xx; `422`s sit under their fields.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { Banner } from '@/components/common/Banner';
import { ErrorSummary } from '@/components/common/ErrorSummary';
import { FieldError, FormField } from '@/components/common/FormField';
import { QtyStepper } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { useTablesView } from '@/hooks/useDiningTables';
import { useBranchClock, useReservationList, useReservationRefresh } from '@/hooks/useReservations';
import { useTabAction } from '@/hooks/useTab';
import { cancelReservation, createReservation, markReservationNoShow, updateReservation } from '@/services/reservations';
import type { Reservation, ReservationCreateRequest } from '@/services/types';
import { branchWallTimeToIso, isoToBranchWallTime, RESERVATION_LIMITS } from '@/utils/tables';
import { businessDateAt } from '@pos/core/businessDay';
import { reservationsClash } from '@pos/core/tables/status';

/** What the cancel and no-show dialogs need of a reservation (a `Reservation` or a table's `reservation`). */
export type ReservationRef = { ulid: string; guest_name: string; party_size: number; reserved_for: string; tableName: string };

// ---------------------------------------------------------------------------
// The 409 dialog
// ---------------------------------------------------------------------------

export function ReservationConflictDialog({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <Dialog open={message !== null} onOpenChange={(next) => (next ? null : onDismiss())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>The reservation changed</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button autoFocus variant="green" onClick={onDismiss}>
            Reload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// New / Edit
// ---------------------------------------------------------------------------

type ReservationFormDialogProps = {
  open: boolean;
  /** `null`: a new reservation. */
  reservation: Reservation | null;
  /** The date a new reservation starts on (`YYYY-MM-DD`, the branch's calendar). */
  defaultDate: string;
  onClose: () => void;
  onConflict: (message: string) => void;
};

export function ReservationFormDialog({ open, reservation, defaultDate, onClose, onConflict }: ReservationFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        {open ? (
          <ReservationForm
            key={reservation?.ulid ?? 'new'}
            reservation={reservation}
            defaultDate={defaultDate}
            onClose={onClose}
            onConflict={onConflict}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type FormBody = Omit<ReservationCreateRequest, 'ulid'>;

function ReservationForm({
  reservation,
  defaultDate,
  onClose,
  onConflict,
}: {
  reservation: Reservation | null;
  defaultDate: string;
  onClose: () => void;
  onConflict: (message: string) => void;
}) {
  const clock = useBranchClock();
  const refresh = useReservationRefresh();
  const tables = useTablesView(true);
  const start = reservation ? isoToBranchWallTime(reservation.reserved_for, clock.timeZone) : null;
  const [tableId, setTableId] = useState<string>(reservation ? String(reservation.table.id) : '');
  const [guestName, setGuestName] = useState(reservation?.guest_name ?? '');
  const [phone, setPhone] = useState(reservation?.phone ?? '');
  const [partySize, setPartySize] = useState(reservation?.party_size ?? 2);
  const [date, setDate] = useState(start?.date ?? defaultDate);
  const [time, setTime] = useState(start?.time ?? '');
  const [notes, setNotes] = useState(reservation?.notes ?? '');
  const [checked, setChecked] = useState(false);

  const action = useTabAction({
    run: (key, body: FormBody) => (reservation ? updateReservation(reservation.ulid, body, key) : createReservation({ ...body, ulid: key })),
    onConflict: (message) => {
      onClose();
      onConflict(message);
    },
  });

  const reservedFor = branchWallTimeToIso(date, time, clock.timeZone);
  const businessDate = reservedFor ? businessDateAt(Date.parse(reservedFor), clock.timeZone, clock.dayStart) : '';
  // The day's other bookings: the table picker marks the tables they clash with (the server decides).
  const bookings = useReservationList(businessDate, { status: 'booked', enabled: businessDate !== '' });
  const clashes = useMemo(() => {
    const byTable = new Map<number, string>();
    if (!reservedFor) return byTable;
    for (const booking of bookings.items) {
      if (booking.ulid === reservation?.ulid) continue;
      if (reservationsClash(booking.reserved_for, reservedFor) && !byTable.has(booking.table.id)) {
        byTable.set(booking.table.id, booking.reserved_for);
      }
    }
    return byTable;
  }, [bookings.items, reservedFor, reservation?.ulid]);

  const chosen = tables.items.find((table) => String(table.id) === tableId) ?? null;
  const tooLarge = chosen !== null && partySize > chosen.seats;
  const clashAt = chosen ? clashes.get(chosen.id) : undefined;

  const errors = {
    table: action.fieldErrors.table_id ?? (checked && tableId === '' ? 'Choose a table.' : null),
    guestName: action.fieldErrors.guest_name ?? (checked && guestName.trim() === '' ? 'Enter the guest name.' : null),
    phone: action.fieldErrors.phone ?? null,
    partySize: action.fieldErrors.party_size ?? null,
    when: action.fieldErrors.reserved_for ?? (checked && !reservedFor ? 'Pick the date and the time.' : null),
    notes: action.fieldErrors.notes ?? null,
  };
  const known = new Set(['table_id', 'guest_name', 'phone', 'party_size', 'reserved_for', 'notes']);
  const otherError = Object.entries(action.fieldErrors).find(([field]) => !known.has(field))?.[1] ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.busy) return;
    setChecked(true);
    if (tableId === '' || guestName.trim() === '' || !reservedFor) return;
    const saved = await action.send({
      table_id: Number(tableId),
      guest_name: guestName.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      party_size: partySize,
      reserved_for: reservedFor,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    if (saved) {
      refresh();
      toast.success(
        reservation
          ? `Reservation for ${saved.guest_name} saved.`
          : `Table ${saved.table.name} reserved for ${saved.guest_name} at ${clock.time(saved.reserved_for)}.`,
      );
      onClose();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={action.busy}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>{reservation ? `Edit reservation for ${reservation.guest_name}` : 'New reservation'}</DialogTitle>
        <DialogDescription>The table is kept free for the guests from shortly before the time. A booking takes its table for 2 hours.</DialogDescription>
      </DialogHeader>
      {action.banner ? <Banner variant="warning">{action.banner}</Banner> : null}
      {otherError ? <Banner>{otherError}</Banner> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Date" error={errors.when}>
          <Input type="date" className="tabular" value={date} onChange={(event) => setDate(event.target.value)} disabled={action.busy} />
        </FormField>
        <FormField label="Time">
          <Input type="time" className="tabular" value={time} onChange={(event) => setTime(event.target.value)} disabled={action.busy} />
        </FormField>
      </div>

      <FormField
        label="Table"
        error={errors.table}
        hint={tables.error ? `Couldn't load the tables: ${tables.error}` : reservedFor ? 'Tables marked "booked" already have a reservation near this time.' : undefined}
      >
        <NativeSelect value={tableId} onChange={(event) => setTableId(event.target.value)} disabled={action.busy || tables.loading}>
          <option value="">{tables.loading ? 'Loading tables…' : 'Choose a table'}</option>
          {tables.items.map((table) => {
            const clash = clashes.get(table.id);
            return (
              <option key={table.id} value={String(table.id)}>
                {`Table ${table.name}${table.area ? ` · ${table.area}` : ''} · ${table.seats} seats${clash ? ` · booked ${clock.time(clash)}` : ''}`}
              </option>
            );
          })}
        </NativeSelect>
      </FormField>
      {clashAt ? (
        <Banner variant="warning">
          Table {chosen?.name} is already reserved at {clock.time(clashAt)}. Pick another table or time.
        </Banner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Guest name" error={errors.guestName}>
          <Input
            value={guestName}
            maxLength={RESERVATION_LIMITS.guestNameMax}
            autoComplete="off"
            onChange={(event) => setGuestName(event.target.value)}
            disabled={action.busy}
          />
        </FormField>
        <FormField label="Phone (optional)" error={errors.phone}>
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            maxLength={RESERVATION_LIMITS.phoneMax}
            autoComplete="off"
            onChange={(event) => setPhone(event.target.value)}
            disabled={action.busy}
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Party size</span>
        <QtyStepper
          value={partySize}
          onChange={setPartySize}
          min={RESERVATION_LIMITS.partyMin}
          max={RESERVATION_LIMITS.partyMax}
          label="party size"
          disabled={action.busy}
        />
        <FieldError message={errors.partySize} />
        {tooLarge ? (
          <p className="text-[13px] font-medium text-warning" role="status">
            Table {chosen.name} seats {chosen.seats}. The party of {partySize} is larger: you can still book it.
          </p>
        ) : null}
      </div>

      <FormField label="Notes (optional)" error={errors.notes}>
        <Textarea value={notes} maxLength={RESERVATION_LIMITS.notesMax} onChange={(event) => setNotes(event.target.value)} disabled={action.busy} />
      </FormField>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={action.busy}>
          Cancel
        </Button>
        <Button type="submit" variant="green" size="lg" disabled={action.busy}>
          {action.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {action.busy ? 'Saving…' : reservation ? 'Save' : 'Reserve table'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cancel and No-show
// ---------------------------------------------------------------------------

type StatusDialogProps = {
  reservation: ReservationRef | null;
  onClose: () => void;
  /** After the change was saved (the dialog closes too). */
  onDone?: () => void;
  onConflict: (message: string) => void;
};

type StatusFormProps = { reservation: ReservationRef; onClose: () => void; onDone?: () => void; onConflict: (message: string) => void };

export function CancelReservationDialog({ reservation, onClose, onDone, onConflict }: StatusDialogProps) {
  return (
    <Dialog open={reservation !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-md">
        {reservation ? <CancelForm key={reservation.ulid} reservation={reservation} onClose={onClose} onDone={onDone} onConflict={onConflict} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({ reservation, onClose, onDone, onConflict }: StatusFormProps) {
  const clock = useBranchClock();
  const refresh = useReservationRefresh();
  const [reason, setReason] = useState('');
  const action = useTabAction({
    run: (key, body: { reason: string | null }) => cancelReservation(reservation.ulid, body, key),
    onConflict: (message) => {
      onClose();
      onConflict(message);
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const done = await action.send({ reason: reason.trim() === '' ? null : reason.trim() });
    if (done) {
      refresh();
      toast.success(`Reservation for ${reservation.guest_name} cancelled.`);
      onClose();
      onDone?.();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={action.busy}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>Cancel reservation</DialogTitle>
        <DialogDescription>
          {reservation.guest_name} · {reservation.party_size} {reservation.party_size === 1 ? 'guest' : 'guests'} · Table {reservation.tableName} ·{' '}
          {clock.time(reservation.reserved_for)}. The table is free again.
        </DialogDescription>
      </DialogHeader>
      {action.banner ? <Banner variant="warning">{action.banner}</Banner> : null}
      <FormField label="Reason (optional)" error={action.fieldErrors.reason}>
        <Input value={reason} maxLength={RESERVATION_LIMITS.reasonMax} autoComplete="off" onChange={(event) => setReason(event.target.value)} disabled={action.busy} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={action.busy}>
          Keep it
        </Button>
        <Button type="submit" variant="destructiveSolid" disabled={action.busy}>
          {action.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {action.busy ? 'Cancelling…' : 'Cancel reservation'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NoShowDialog({ reservation, onClose, onDone, onConflict }: StatusDialogProps) {
  return (
    <Dialog open={reservation !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-md">
        {reservation ? <NoShowForm key={reservation.ulid} reservation={reservation} onClose={onClose} onDone={onDone} onConflict={onConflict} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NoShowForm({ reservation, onClose, onDone, onConflict }: StatusFormProps) {
  const clock = useBranchClock();
  const refresh = useReservationRefresh();
  const action = useTabAction({
    run: (key: string) => markReservationNoShow(reservation.ulid, key),
    onConflict: (message) => {
      onClose();
      onConflict(message);
    },
  });

  async function onConfirm() {
    const done = await action.send(null);
    if (done) {
      refresh();
      toast.success(`${reservation.guest_name} marked as a no-show.`);
      onClose();
      onDone?.();
    }
  }

  const otherError = Object.values(action.fieldErrors)[0] ?? null;
  return (
    <div className="flex flex-col gap-4" aria-busy={action.busy}>
      <DialogHeader>
        <DialogTitle>Mark as no-show</DialogTitle>
        <DialogDescription>
          {reservation.guest_name} didn't come for Table {reservation.tableName} at {clock.time(reservation.reserved_for)}. The table is free again.
        </DialogDescription>
      </DialogHeader>
      {action.banner ? <Banner variant="warning">{action.banner}</Banner> : null}
      {otherError ? <Banner>{otherError}</Banner> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={action.busy}>
          Keep it
        </Button>
        <Button variant="destructiveSolid" disabled={action.busy} onClick={() => void onConfirm()}>
          {action.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {action.busy ? 'Saving…' : 'Mark no-show'}
        </Button>
      </DialogFooter>
    </div>
  );
}
