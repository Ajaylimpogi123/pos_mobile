/**
 * Hardening & Pilot (Phase 8) §F: SQLite storage of app errors waiting to be
 * sent (`error_queue`). Each row is a redacted `ClientError` as JSON.
 *
 * - At most `ERROR_QUEUE_LIMIT` (200) rows: an insert drops the oldest beyond it.
 * - Read oldest first, in batches; a row is deleted only once the server has it.
 * - The same `ulid` is stored once.
 */
import { asc, count, inArray, lte } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { errorQueue } from '@/db/schema';
import type { ClientError } from '@/services/types';

/** §F: the queue holds up to 200 entries; the oldest are dropped first. */
export const ERROR_QUEUE_LIMIT = 200;

/** Stores errors (oldest first), then trims the queue to the limit. */
async function enqueue(errors: readonly ClientError[], now: string): Promise<void> {
  if (errors.length === 0) return;
  const db = getDb();
  db.transaction((tx) => {
    for (const error of errors) {
      tx.insert(errorQueue)
        .values({ ulid: error.ulid, payload: JSON.stringify(error), created_at: now })
        .onConflictDoNothing({ target: errorQueue.ulid })
        .run();
    }
    const total = tx.select({ total: count() }).from(errorQueue).get()?.total ?? 0;
    const excess = total - ERROR_QUEUE_LIMIT;
    if (excess > 0) {
      const cutoff = tx.select({ id: errorQueue.id }).from(errorQueue).orderBy(asc(errorQueue.id)).limit(1).offset(excess - 1).get();
      if (cutoff) tx.delete(errorQueue).where(lte(errorQueue.id, cutoff.id)).run();
    }
  });
}

/** The oldest `limit` errors. A row that can't be parsed is deleted (it could never be sent). */
async function nextBatch(limit: number): Promise<ClientError[]> {
  const db = getDb();
  const rows = db.select().from(errorQueue).orderBy(asc(errorQueue.id)).limit(limit).all();
  const out: ClientError[] = [];
  const broken: number[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.payload) as ClientError);
    } catch {
      broken.push(row.id);
    }
  }
  if (broken.length > 0) db.delete(errorQueue).where(inArray(errorQueue.id, broken)).run();
  return out;
}

/** Removes the errors the server has (accepted or duplicates). */
async function remove(ulids: readonly string[]): Promise<void> {
  if (ulids.length === 0) return;
  getDb().delete(errorQueue).where(inArray(errorQueue.ulid, [...ulids])).run();
}

async function countQueued(): Promise<number> {
  return getDb().select({ total: count() }).from(errorQueue).get()?.total ?? 0;
}

export type ErrorQueueRepository = {
  enqueue: typeof enqueue;
  nextBatch: typeof nextBatch;
  remove: typeof remove;
  count: typeof countQueued;
};

export const errorQueueRepository: ErrorQueueRepository = {
  enqueue,
  nextBatch,
  remove,
  count: countQueued,
};
