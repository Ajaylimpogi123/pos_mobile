import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { tableKeys } from '@/hooks/tables/queryKeys';
import { branchDateAndTime, branchIso, nextQuarterHour } from '@/hooks/tables/reservationTime';
import { useBranchTime } from '@/hooks/tables/useBranchTime';
import { useReservationActions } from '@/hooks/tables/useReservationActions';
import { fetchAllTables, isDineInOff, TABLES_POLL_MS } from '@/hooks/tables/useTablesView';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { createReservation, listReservations, updateReservation } from '@/services/reservations';
import type { Reservation, ReservationCreateRequest, ReservationStatus, ReservationUpdateRequest, TableView } from '@/services/types';
import { IN_FLIGHT_MESSAGE, KEY_REUSED_MESSAGE } from '@/sale/orderErrors';
import { showToast } from '@/stores/toast';
import { ulid as makeUlid } from '@/utils/ulid';
import { reservationsClash } from '@pos/core/tables/status';

/** Safety cap on pages read at once (100 reservations a page). */
const MAX_PAGES = 10;

/** §E.2 limits (the server checks them too). */
export const RESERVATION_LIMITS = { guestNameMax: 60, phoneMax: 20, partyMin: 1, partyMax: 99, notesMax: 255, pastMinutes: 15, aheadDays: 90 } as const;
const PHONE_PATTERN = /^[0-9+ ()-]+$/;
export const RESERVED_FOR_RANGE_MESSAGE = 'Pick a time from now up to 90 days ahead.';
export const RESERVATION_SAVED_MESSAGE = 'Reservation saved.';

/** GET /api/v1/reservations for one business day (every page), by time. */
export async function fetchReservations(date: string, status?: ReservationStatus): Promise<Reservation[]> {
  const rows: Reservation[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listReservations({ date, status, cursor, per_page: 100 });
    rows.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return rows;
}

/** One business day's reservations (polled every 15 s while `enabled`). */
export function useDayReservations(date: string, enabled: boolean, status?: ReservationStatus) {
  return useQuery({
    queryKey: tableKeys.reservationsFor(date, status ?? null),
    queryFn: () => fetchReservations(date, status),
    enabled,
    refetchInterval: enabled ? TABLES_POLL_MS : false,
    refetchOnMount: 'always',
  });
}

export type ReservationDraft = {
  /** The reservation being edited, or `null` for a new one. */
  editing: Reservation | null;
  /** The `Idempotency-Key` (and a new reservation's `ulid`), made when the form opens. */
  key: string;
  tableId: number | null;
  guestName: string;
  phone: string;
  partySize: number;
  /** The branch's calendar date, `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, 24 h, in the branch zone. */
  time: string;
  notes: string;
};

export type ReservationField = 'table_id' | 'guest_name' | 'phone' | 'party_size' | 'reserved_for' | 'notes';
export type ReservationErrors = Partial<Record<ReservationField, string>>;

const FIELDS: readonly ReservationField[] = ['table_id', 'guest_name', 'phone', 'party_size', 'reserved_for', 'notes'];

/** The §E.2 checks on the device, and the body (`null` with errors). */
export function checkReservationDraft(
  draft: ReservationDraft,
  timeZone: string,
  now: number,
): { body: Omit<ReservationCreateRequest, 'ulid'> | null; errors: ReservationErrors } {
  // Q-053.8: the 15-minute / 90-day window applies only when the time is sent (an edit that keeps it may be late).
  const keepsTime = (iso: string) => draft.editing !== null && Date.parse(iso) === Date.parse(draft.editing.reserved_for);
  const errors: ReservationErrors = {};
  if (draft.tableId === null) errors.table_id = 'Pick a table.';
  const guestName = draft.guestName.trim();
  if (guestName === '') errors.guest_name = "Enter the guest's name.";
  else if (guestName.length > RESERVATION_LIMITS.guestNameMax) errors.guest_name = `Use ${RESERVATION_LIMITS.guestNameMax} characters or fewer.`;
  const phone = draft.phone.trim();
  if (phone.length > RESERVATION_LIMITS.phoneMax) errors.phone = `Use ${RESERVATION_LIMITS.phoneMax} characters or fewer.`;
  else if (phone !== '' && !PHONE_PATTERN.test(phone)) errors.phone = 'Use numbers, spaces, +, ( ) and - only.';
  if (!Number.isInteger(draft.partySize) || draft.partySize < RESERVATION_LIMITS.partyMin || draft.partySize > RESERVATION_LIMITS.partyMax) {
    errors.party_size = `Enter ${RESERVATION_LIMITS.partyMin} to ${RESERVATION_LIMITS.partyMax} guests.`;
  }
  const reservedFor = branchIso(draft.date, draft.time, timeZone);
  if (reservedFor === null) errors.reserved_for = 'Pick a date and a time.';
  else if (!keepsTime(reservedFor)) {
    const at = Date.parse(reservedFor);
    if (at < now - RESERVATION_LIMITS.pastMinutes * 60_000 || at > now + RESERVATION_LIMITS.aheadDays * 24 * 60 * 60_000) {
      errors.reserved_for = RESERVED_FOR_RANGE_MESSAGE;
    }
  }
  const notes = draft.notes.trim();
  if (notes.length > RESERVATION_LIMITS.notesMax) errors.notes = `Use ${RESERVATION_LIMITS.notesMax} characters or fewer.`;
  if (Object.keys(errors).length > 0 || draft.tableId === null || reservedFor === null) return { body: null, errors };
  return {
    body: {
      table_id: draft.tableId,
      guest_name: guestName,
      phone: phone === '' ? null : phone,
      party_size: draft.partySize,
      reserved_for: reservedFor,
      notes: notes === '' ? null : notes,
    },
    errors,
  };
}

/** An edit's PATCH body: only the fields that changed (Q-053.8). */
export function changedReservationFields(original: Reservation, body: Omit<ReservationCreateRequest, 'ulid'>): ReservationUpdateRequest {
  const changes: ReservationUpdateRequest = {};
  if (body.table_id !== original.table.id) changes.table_id = body.table_id;
  if (body.guest_name !== original.guest_name) changes.guest_name = body.guest_name;
  if ((body.phone ?? null) !== original.phone) changes.phone = body.phone ?? null;
  if (body.party_size !== original.party_size) changes.party_size = body.party_size;
  if (Date.parse(body.reserved_for) !== Date.parse(original.reserved_for)) changes.reserved_for = body.reserved_for;
  if ((body.notes ?? null) !== original.notes) changes.notes = body.notes ?? null;
  return changes;
}

/** The ids of the tables that already have a booked reservation within 120 minutes of `reservedFor` (§E clash rule). */
export function clashingTableIds(reservedFor: string | null, booked: readonly Reservation[], editingUlid: string | null): Set<number> {
  const ids = new Set<number>();
  if (reservedFor === null) return ids;
  for (const other of booked) {
    if (other.status !== 'booked' || other.ulid === editingUlid) continue;
    if (reservationsClash(reservedFor, other.reserved_for)) ids.add(other.table.id);
  }
  return ids;
}

/**
 * Tables → **Reservations** (Table Management §E and §F; `sale.create`;
 * online only): the day picker (business days) with the day's reservations
 * by time, the **New reservation** / **Edit** form, and the row actions
 * (**Seat now** today only, **Cancel**, **No-show**). The form's draft lives
 * here, above any layout switch, so rotation keeps it.
 */
export function useReservations(enabled: boolean) {
  const client = useQueryClient();
  const online = useIsOnline();
  const { timeZone, today } = useBranchTime();
  const [date, setDate] = useState(today);
  const list = useDayReservations(date, enabled && online);
  const actions = useReservationActions();

  const [draft, setDraft] = useState<ReservationDraft | null>(null);
  const [errors, setErrors] = useState<ReservationErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const tablesQuery = useQuery({ queryKey: tableKeys.tablesView(), queryFn: fetchAllTables, enabled: draft !== null && online });
  const formDay = useDayReservations(draft?.date ?? date, draft !== null && online, 'booked');
  const reservedFor = draft ? branchIso(draft.date, draft.time, timeZone) : null;
  const clashes = useMemo(
    () => clashingTableIds(reservedFor, formDay.data ?? [], draft?.editing?.ulid ?? null),
    [reservedFor, formDay.data, draft?.editing?.ulid],
  );
  const tables: TableView[] = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const table = draft && draft.tableId !== null ? (tables.find((row) => row.id === draft.tableId) ?? null) : null;
  const seatsWarning = table && draft && draft.partySize > table.seats ? `The party is larger than Table ${table.name}'s ${table.seats} seats.` : null;

  function reloadAll() {
    void client.invalidateQueries({ queryKey: tableKeys.reservations() });
    void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
    void client.invalidateQueries({ queryKey: tableKeys.summary() });
  }

  function openNew() {
    const start = date >= today() ? date : today();
    const next = nextQuarterHour(Date.now(), timeZone);
    setErrors({});
    setBanner(null);
    setDraft({
      editing: null,
      key: makeUlid(),
      tableId: null,
      guestName: '',
      phone: '',
      partySize: 2,
      date: start === next.date ? next.date : start,
      time: start === next.date ? next.time : '19:00',
      notes: '',
    });
  }

  function openEdit(reservation: Reservation) {
    const local = branchDateAndTime(reservation.reserved_for, timeZone);
    setErrors({});
    setBanner(null);
    setDraft({
      editing: reservation,
      key: makeUlid(),
      tableId: reservation.table.id,
      guestName: reservation.guest_name,
      phone: reservation.phone ?? '',
      partySize: reservation.party_size,
      date: local?.date ?? reservation.business_date,
      time: local?.time ?? '19:00',
      notes: reservation.notes ?? '',
    });
  }

  async function submit() {
    if (!draft || inFlight.current) return;
    const checked = checkReservationDraft(draft, timeZone, Date.now());
    setErrors(checked.errors);
    setBanner(null);
    if (!checked.body) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      if (draft.editing) {
        const changes = changedReservationFields(draft.editing, checked.body);
        if (Object.keys(changes).length > 0) await updateReservation(draft.editing.ulid, changes, draft.key);
      } else await createReservation({ ulid: draft.key, ...checked.body });
      setDraft(null);
      reloadAll();
      showToast(RESERVATION_SAVED_MESSAGE);
    } catch (error) {
      if (isApiValidationError(error)) {
        const mapped: ReservationErrors = {};
        for (const field of FIELDS) {
          const message = error.firstError(field);
          if (message) mapped[field] = message;
        }
        setErrors(mapped);
        if (Object.keys(mapped).length === 0) setBanner(error.message);
      } else if (isApiError(error) && error.status === 409 && error.message !== IN_FLIGHT_MESSAGE && error.message !== KEY_REUSED_MESSAGE) {
        setDraft(null);
        actions.showConflict(error.message);
      } else {
        // A network error keeps the key: a retry can't book twice.
        setBanner(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return {
    online,
    date,
    today: today(),
    setDate: (value: string | null) => setDate(value ?? today()),
    list,
    rows: list.data ?? [],
    dineInOff: isDineInOff(list.error),
    actions,
    draft,
    errors,
    banner,
    submitting,
    tables,
    tablesLoading: tablesQuery.isPending && draft !== null,
    tablesError: tablesQuery.error,
    retryTables: () => void tablesQuery.refetch(),
    clashes,
    seatsWarning,
    openNew,
    openEdit,
    change: (patch: Partial<Omit<ReservationDraft, 'editing' | 'key'>>) => {
      setDraft((current) => (current ? { ...current, ...patch } : current));
      setErrors((current) => {
        const next = { ...current };
        if ('tableId' in patch) delete next.table_id;
        if ('guestName' in patch) delete next.guest_name;
        if ('phone' in patch) delete next.phone;
        if ('partySize' in patch) delete next.party_size;
        if ('date' in patch || 'time' in patch) delete next.reserved_for;
        if ('notes' in patch) delete next.notes;
        return next;
      });
    },
    close: () => {
      if (!inFlight.current) setDraft(null);
    },
    submit: () => void submit(),
  };
}

export type ReservationsState = ReturnType<typeof useReservations>;
