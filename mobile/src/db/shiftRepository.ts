/**
 * SQLite storage for this tablet's cash shifts (docs/api-contract.md →
 * Shifts & Reporting → Device rules): `shifts` and `cash_movements`, with
 * their `outbox` rows.
 *
 * **Every shift write is one transaction** with its outbox row, so it works
 * offline and nothing is lost: opening (`shift_open`), a cash movement
 * (`cash_movement`) and closing (`shift_close`). Shift events always go
 * through the outbox, online or offline (`@/sync/outboxSync` sends them).
 *
 * Only the current shift and the last 7 days are kept (`pruneClosedShifts`).
 */
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import type { ShiftEventPayload } from '@/db/offlineRepository';
import { cashMovements, outbox, shifts, type CashMovementRow, type ShiftRow } from '@/db/schema';
import type {
  CashMovementRequest,
  CashMovementType,
  ShiftCloseRequest,
  ShiftOpenRequest,
  ShiftStatus,
  UserRef,
} from '@/services/types';

/** A shift stored on this tablet. */
export type LocalShift = {
  ulid: string;
  branchId: number;
  status: ShiftStatus;
  openedAt: string;
  openedBy: UserRef;
  openingFloatCents: number;
  closedAt: string | null;
  /** `null` while open, and when the server had already closed it. */
  closedBy: UserRef | null;
  countedCashCents: number | null;
  closeNote: string | null;
};

/** A cash movement stored on this tablet. */
export type LocalCashMovement = {
  ulid: string;
  shiftUlid: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  occurredAt: string;
  user: UserRef;
};

export type OpenShiftDraft = {
  ulid: string;
  branchId: number;
  /** ISO 8601 UTC. */
  openedAt: string;
  openedBy: UserRef;
  openingFloatCents: number;
};

export type OpenShiftResult = {
  shift: LocalShift;
  /** `false`: a shift was already open for this branch (nothing new was written). */
  created: boolean;
};

export type CashMovementDraft = {
  ulid: string;
  shiftUlid: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  /** ISO 8601 UTC. */
  occurredAt: string;
  user: UserRef;
};

export type CloseShiftDraft = {
  shiftUlid: string;
  /** A ULID made for the close: the key of its outbox row. */
  eventUlid: string;
  /** ISO 8601 UTC. */
  closedAt: string;
  closedBy: UserRef;
  countedCashCents: number;
  closeNote: string | null;
};

/** The shift isn't open any more (closed on this tablet, or by the server). */
export class ShiftNotOpenError extends Error {
  constructor() {
    super('This shift is already closed.');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ShiftNotOpenError';
  }
}

function toShift(row: ShiftRow): LocalShift {
  return {
    ulid: row.ulid,
    branchId: row.branch_id,
    status: row.status,
    openedAt: row.opened_at,
    openedBy: { id: row.opened_by_id, name: row.opened_by_name },
    openingFloatCents: row.opening_float_cents,
    closedAt: row.closed_at,
    closedBy: row.closed_by_id !== null ? { id: row.closed_by_id, name: row.closed_by_name ?? '' } : null,
    countedCashCents: row.counted_cash_cents,
    closeNote: row.close_note,
  };
}

function toMovement(row: CashMovementRow): LocalCashMovement {
  return {
    ulid: row.ulid,
    shiftUlid: row.shift_ulid,
    type: row.type,
    amountCents: row.amount_cents,
    reason: row.reason,
    occurredAt: row.occurred_at,
    user: { id: row.user_id, name: row.user_name },
  };
}

/** This tablet's open shift for the branch (the newest, should there ever be two), or `null`. */
async function currentShift(branchId: number): Promise<LocalShift | null> {
  const row = getDb()
    .select()
    .from(shifts)
    .where(and(eq(shifts.branch_id, branchId), eq(shifts.status, 'open')))
    .orderBy(desc(shifts.opened_at), desc(shifts.ulid))
    .limit(1)
    .get();
  return row ? toShift(row) : null;
}

async function getShift(ulid: string): Promise<LocalShift | null> {
  const row = getDb().select().from(shifts).where(eq(shifts.ulid, ulid)).get();
  return row ? toShift(row) : null;
}

/** The shift's cash movements, oldest first. */
async function listCashMovements(shiftUlid: string): Promise<LocalCashMovement[]> {
  return getDb()
    .select()
    .from(cashMovements)
    .where(eq(cashMovements.shift_ulid, shiftUlid))
    .orderBy(asc(cashMovements.occurred_at), asc(cashMovements.ulid))
    .all()
    .map(toMovement);
}

/**
 * Opens a shift: the `shifts` row and its `shift_open` outbox row, in one
 * transaction. One shift per tablet: when one is already open for the
 * branch, it is returned and nothing is written.
 */
async function openShift(draft: OpenShiftDraft): Promise<OpenShiftResult> {
  let result: OpenShiftResult | null = null;
  getDb().transaction((tx) => {
    const open = tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.branch_id, draft.branchId), eq(shifts.status, 'open')))
      .orderBy(desc(shifts.opened_at))
      .limit(1)
      .get();
    if (open) {
      result = { shift: toShift(open), created: false };
      return;
    }

    const row: ShiftRow = {
      ulid: draft.ulid,
      branch_id: draft.branchId,
      status: 'open',
      opened_at: draft.openedAt,
      opened_by_id: draft.openedBy.id,
      opened_by_name: draft.openedBy.name,
      opening_float_cents: draft.openingFloatCents,
      closed_at: null,
      closed_by_id: null,
      closed_by_name: null,
      counted_cash_cents: null,
      close_note: null,
      created_at: draft.openedAt,
      updated_at: draft.openedAt,
    };
    tx.insert(shifts).values(row).run();

    const payload: ShiftEventPayload<ShiftOpenRequest> = {
      ulid: draft.ulid,
      shift_ulid: draft.ulid,
      body: {
        ulid: draft.ulid,
        opened_at: draft.openedAt,
        opened_by: draft.openedBy.id,
        opening_float_cents: draft.openingFloatCents,
      },
    };
    tx.insert(outbox)
      .values({
        ulid: draft.ulid,
        entity: 'shift_open',
        payload: JSON.stringify(payload),
        attempts: 0,
        next_attempt_at: draft.openedAt,
        status: 'pending',
        last_error: null,
        created_at: draft.openedAt,
      })
      .run();
    result = { shift: toShift(row), created: true };
  });
  if (!result) throw new Error('The shift could not be stored.');
  return result;
}

/**
 * Records cash in or out of the drawer: the movement and its `cash_movement`
 * outbox row, in one transaction. Throws `ShiftNotOpenError` when the shift
 * is no longer open on this tablet.
 */
async function addCashMovement(draft: CashMovementDraft): Promise<LocalCashMovement> {
  let movement: LocalCashMovement | null = null;
  getDb().transaction((tx) => {
    const shift = tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.ulid, draft.shiftUlid)).get();
    if (!shift || shift.status !== 'open') throw new ShiftNotOpenError();

    const row: CashMovementRow = {
      ulid: draft.ulid,
      shift_ulid: draft.shiftUlid,
      type: draft.type,
      amount_cents: draft.amountCents,
      reason: draft.reason,
      occurred_at: draft.occurredAt,
      user_id: draft.user.id,
      user_name: draft.user.name,
    };
    tx.insert(cashMovements).values(row).run();

    const payload: ShiftEventPayload<CashMovementRequest> = {
      ulid: draft.ulid,
      shift_ulid: draft.shiftUlid,
      body: {
        ulid: draft.ulid,
        type: draft.type,
        amount_cents: draft.amountCents,
        reason: draft.reason,
        occurred_at: draft.occurredAt,
        user_id: draft.user.id,
      },
    };
    tx.insert(outbox)
      .values({
        ulid: draft.ulid,
        entity: 'cash_movement',
        payload: JSON.stringify(payload),
        attempts: 0,
        next_attempt_at: draft.occurredAt,
        status: 'pending',
        last_error: null,
        created_at: draft.occurredAt,
      })
      .run();
    movement = toMovement(row);
  });
  if (!movement) throw new Error('The cash movement could not be stored.');
  return movement;
}

/**
 * Closes the shift: the counted cash, who and when, and its `shift_close`
 * outbox row, in one transaction. Throws `ShiftNotOpenError` when it is
 * already closed.
 */
async function closeShift(draft: CloseShiftDraft): Promise<LocalShift> {
  let closed: LocalShift | null = null;
  getDb().transaction((tx) => {
    const rows = tx
      .update(shifts)
      .set({
        status: 'closed',
        closed_at: draft.closedAt,
        closed_by_id: draft.closedBy.id,
        closed_by_name: draft.closedBy.name,
        counted_cash_cents: draft.countedCashCents,
        close_note: draft.closeNote,
        updated_at: draft.closedAt,
      })
      .where(and(eq(shifts.ulid, draft.shiftUlid), eq(shifts.status, 'open')))
      .returning()
      .all();
    if (rows.length === 0) throw new ShiftNotOpenError();

    const payload: ShiftEventPayload<ShiftCloseRequest> = {
      ulid: draft.eventUlid,
      shift_ulid: draft.shiftUlid,
      body: {
        closed_at: draft.closedAt,
        closed_by: draft.closedBy.id,
        counted_cash_cents: draft.countedCashCents,
        close_note: draft.closeNote,
      },
    };
    tx.insert(outbox)
      .values({
        ulid: draft.eventUlid,
        entity: 'shift_close',
        payload: JSON.stringify(payload),
        attempts: 0,
        next_attempt_at: draft.closedAt,
        status: 'pending',
        last_error: null,
        created_at: draft.closedAt,
      })
      .run();
    closed = toShift(rows[0]);
  });
  if (!closed) throw new ShiftNotOpenError();
  return closed;
}

/**
 * The server said this shift is closed (`422` on `shift_ulid`): it is closed
 * here too, with no counted cash and nothing sent (the server already has
 * it). Returns `false` when it wasn't open.
 */
async function markClosedByServer(ulid: string, now: string): Promise<boolean> {
  const rows = getDb()
    .update(shifts)
    .set({ status: 'closed', closed_at: now, updated_at: now })
    .where(and(eq(shifts.ulid, ulid), eq(shifts.status, 'open')))
    .returning({ ulid: shifts.ulid })
    .all();
  return rows.length > 0;
}

/**
 * Deletes shifts closed before `cutoff` (ISO 8601 UTC) whose events have all
 * reached the server, and the cash movements of every shift no longer
 * stored. An open shift, or one with an event still in the outbox, is kept.
 * Returns how many shifts were deleted.
 */
async function pruneClosedShifts(cutoff: string): Promise<number> {
  let deleted = 0;
  getDb().transaction((tx) => {
    const rows = tx
      .delete(shifts)
      .where(
        and(
          eq(shifts.status, 'closed'),
          lt(shifts.closed_at, cutoff),
          sql`NOT EXISTS (SELECT 1 FROM ${outbox} WHERE ${outbox.entity} <> 'order' AND json_extract(${outbox.payload}, '$.shift_ulid') = ${shifts.ulid})`,
        ),
      )
      .returning({ ulid: shifts.ulid })
      .all();
    deleted = rows.length;
    tx.delete(cashMovements)
      .where(sql`${cashMovements.shift_ulid} NOT IN (SELECT ${shifts.ulid} FROM ${shifts})`)
      .run();
  });
  return deleted;
}

export type ShiftRepository = {
  currentShift: typeof currentShift;
  getShift: typeof getShift;
  listCashMovements: typeof listCashMovements;
  openShift: typeof openShift;
  addCashMovement: typeof addCashMovement;
  closeShift: typeof closeShift;
  markClosedByServer: typeof markClosedByServer;
  pruneClosedShifts: typeof pruneClosedShifts;
};

/** The SQLite-backed repository used by the app. */
export const shiftRepository: ShiftRepository = {
  currentShift,
  getShift,
  listCashMovements,
  openShift,
  addCashMovement,
  closeShift,
  markClosedByServer,
  pruneClosedShifts,
};
