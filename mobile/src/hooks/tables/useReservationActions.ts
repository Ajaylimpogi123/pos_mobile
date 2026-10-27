import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { tabRoute } from '@/constants/routes';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { cancelReservation, markReservationNoShow } from '@/services/reservations';
import { openTab } from '@/services/tables';
import type { Reservation, TableView } from '@/services/types';
import { IN_FLIGHT_MESSAGE, KEY_REUSED_MESSAGE } from '@/sale/orderErrors';
import { showToast } from '@/stores/toast';
import { ulid as makeUlid } from '@/utils/ulid';

/** Max 255 (§E.4). */
export const CANCEL_REASON_MAX = 255;

/** What the actions need to know about a booked reservation (from a `Reservation` or a table's summary). */
export type ReservationTarget = {
  ulid: string;
  tableId: number;
  tableName: string;
  guestName: string;
  partySize: number;
  reservedFor: string;
};

export function targetOfReservation(reservation: Reservation): ReservationTarget {
  return {
    ulid: reservation.ulid,
    tableId: reservation.table.id,
    tableName: reservation.table.name,
    guestName: reservation.guest_name,
    partySize: reservation.party_size,
    reservedFor: reservation.reserved_for,
  };
}

export function targetOfTable(table: TableView): ReservationTarget | null {
  const reservation = table.reservation;
  if (!reservation) return null;
  return {
    ulid: reservation.ulid,
    tableId: table.id,
    tableName: table.name,
    guestName: reservation.guest_name,
    partySize: reservation.party_size,
    reservedFor: reservation.reserved_for,
  };
}

/** A `409` about the reservation or the table (not about the idempotency key): shown in a dialog, then the lists reload. */
export function isReservationConflict(error: unknown): error is Error {
  if (!isApiError(error) || error.status !== 409) return false;
  const message = error.message.trim();
  return message !== IN_FLIGHT_MESSAGE && message !== KEY_REUSED_MESSAGE;
}

export type ReservationActionKind = 'cancel' | 'no_show';

type Pending = {
  kind: ReservationActionKind;
  target: ReservationTarget;
  /** The `Idempotency-Key`, made when the dialog opens and kept until it succeeds. */
  key: string;
  reason: string;
  error: string | null;
};

/**
 * The actions on a booked reservation (Table Management §E and §F), online only:
 * - **Seat now**: `POST /tabs` with `reservation_ulid` (guests default to the
 *   party size), then the bill opens. A retry after a network error keeps the key.
 * - **Cancel** (optional reason) and **No-show**, each confirmed in a dialog.
 * A `409` (no longer booked, too early, dine-in off) shows in a dialog and the
 * lists reload; `422`s show in the dialog's banner.
 */
export function useReservationActions() {
  const client = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [seatingUlid, setSeatingUlid] = useState<string | null>(null);
  const [seatError, setSeatError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const seatKey = useRef<{ ulid: string; key: string } | null>(null);

  function reload() {
    void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
    void client.invalidateQueries({ queryKey: tableKeys.reservations() });
    void client.invalidateQueries({ queryKey: tableKeys.summary() });
  }

  async function seat(target: ReservationTarget, onSeated?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    const key = seatKey.current?.ulid === target.ulid ? seatKey.current.key : makeUlid();
    seatKey.current = { ulid: target.ulid, key };
    setSeatingUlid(target.ulid);
    setSeatError(null);
    try {
      const tab = await openTab({ ulid: key, table_id: target.tableId, reservation_ulid: target.ulid });
      seatKey.current = null;
      client.setQueryData(tableKeys.tab(tab.ulid), tab);
      reload();
      onSeated?.();
      router.push(tabRoute(tab.ulid));
    } catch (error) {
      if (isReservationConflict(error)) {
        seatKey.current = null;
        reload();
        onSeated?.();
        setConflict(error.message);
      } else if (isApiValidationError(error)) {
        seatKey.current = null;
        setSeatError(error.firstError('table_id') ?? error.firstError('reservation_ulid') ?? error.message);
      } else {
        // A network error keeps the key: a retry finds the bill the first attempt may have opened.
        setSeatError(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSeatingUlid(null);
    }
  }

  async function confirm() {
    if (!pending || inFlight.current) return;
    if (pending.reason.trim().length > CANCEL_REASON_MAX) {
      setPending({ ...pending, error: `Use ${CANCEL_REASON_MAX} characters or fewer.` });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setPending({ ...pending, error: null });
    try {
      if (pending.kind === 'cancel') {
        const reason = pending.reason.trim();
        await cancelReservation(pending.target.ulid, { reason: reason === '' ? null : reason }, pending.key);
        showToast('Reservation cancelled.');
      } else {
        await markReservationNoShow(pending.target.ulid, pending.key);
        showToast('Marked as no-show.');
      }
      setPending(null);
      reload();
    } catch (error) {
      if (isReservationConflict(error)) {
        setPending(null);
        reload();
        setConflict(error.message);
      } else {
        const message = isApiValidationError(error) ? (error.firstError('reason') ?? error.message) : getErrorMessage(error);
        setPending((current) => (current ? { ...current, error: message } : current));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    pending,
    busy,
    seatingUlid,
    seatError,
    conflict,
    seat: (target: ReservationTarget, onSeated?: () => void) => void seat(target, onSeated),
    clearSeatError: () => setSeatError(null),
    ask: (kind: ReservationActionKind, target: ReservationTarget) => setPending({ kind, target, key: makeUlid(), reason: '', error: null }),
    setReason: (reason: string) => setPending((current) => (current ? { ...current, reason, error: null } : current)),
    confirm: () => void confirm(),
    dismiss: () => {
      if (!inFlight.current) setPending(null);
    },
    dismissConflict: () => setConflict(null),
    /** Another screen part (the reservation form) got a `409`: the same dialog, and the lists reload. */
    showConflict: (message: string) => {
      reload();
      setConflict(message);
    },
  };
}

export type ReservationActionsState = ReturnType<typeof useReservationActions>;
