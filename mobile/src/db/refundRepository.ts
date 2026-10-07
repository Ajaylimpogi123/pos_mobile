/**
 * SQLite storage for the refunds made on this tablet (docs/api-contract.md →
 * Voids & Refunds (Phase 7) → Device rules → Local data): `local_refunds`,
 * one row per refund the server answered `201` for, with the `Refund` JSON.
 * The tablet's X-read and Z-read count them in the refund's shift.
 *
 * Pruned like synced sales: after 7 days, except for the current shift.
 * Drizzle's expo-sqlite driver is synchronous; the functions return promises
 * so callers (and tests) treat the store as an async boundary.
 */
import { and, asc, eq, lt, ne, type SQL } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { localRefunds, type LocalRefundRow } from '@/db/schema';
import type { Refund } from '@/services/types';

/** A `local_refunds` row with its JSON parsed. */
export type LocalRefundRecord = {
  ulid: string;
  orderUlid: string;
  shiftUlid: string;
  refund: Refund;
  createdAt: string;
};

function toRecord(row: LocalRefundRow): LocalRefundRecord | null {
  try {
    const refund = JSON.parse(row.refund_json) as Refund;
    if (typeof refund !== 'object' || refund === null) return null;
    return { ulid: row.ulid, orderUlid: row.order_ulid, shiftUlid: row.shift_ulid, refund, createdAt: row.created_at };
  } catch {
    return null;
  }
}

/**
 * Stores a refund the server has (its `201`). A refund already stored (a
 * replayed `201`) is left as it is. Returns `true` when a row was written.
 */
async function saveRefund(orderUlid: string, refund: Refund, now: string): Promise<boolean> {
  const rows = getDb()
    .insert(localRefunds)
    .values({
      ulid: refund.ulid,
      order_ulid: orderUlid,
      shift_ulid: refund.shift_ulid,
      refund_json: JSON.stringify(refund),
      created_at: now,
    })
    .onConflictDoNothing()
    .returning({ ulid: localRefunds.ulid })
    .all();
  return rows.length > 0;
}

/** The refunds of a shift made on this tablet, oldest first. */
async function listForShift(shiftUlid: string): Promise<LocalRefundRecord[]> {
  return getDb()
    .select()
    .from(localRefunds)
    .where(eq(localRefunds.shift_ulid, shiftUlid))
    .orderBy(asc(localRefunds.created_at), asc(localRefunds.ulid))
    .all()
    .map(toRecord)
    .filter((record): record is LocalRefundRecord => record !== null);
}

/**
 * Deletes refunds stored before `cutoff` (ISO 8601 UTC), except those of
 * `keepShiftUlid` (the current shift). Returns how many were deleted.
 */
async function pruneRefunds(cutoff: string, keepShiftUlid: string | null): Promise<number> {
  const conditions: SQL[] = [lt(localRefunds.created_at, cutoff)];
  if (keepShiftUlid !== null) conditions.push(ne(localRefunds.shift_ulid, keepShiftUlid));
  const rows = getDb()
    .delete(localRefunds)
    .where(and(...conditions))
    .returning({ ulid: localRefunds.ulid })
    .all();
  return rows.length;
}

export type RefundRepository = {
  saveRefund: typeof saveRefund;
  listForShift: typeof listForShift;
  pruneRefunds: typeof pruneRefunds;
};

/** The SQLite-backed repository used by the app. */
export const refundRepository: RefundRepository = {
  saveRefund,
  listForShift,
  pruneRefunds,
};
