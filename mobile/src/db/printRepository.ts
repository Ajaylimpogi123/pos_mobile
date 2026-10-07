/**
 * SQLite storage for printing (docs/api-contract.md → Printing → Device rules):
 * the cached print config and the persistent print queue (`print_jobs`).
 *
 * Drizzle's expo-sqlite driver is synchronous; the functions return promises
 * so callers (and tests) treat the store as an async boundary, like
 * `catalogueRepository`.
 */
import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { printConfig, printJobs, type PrintJobInsert, type PrintJobRow } from '@/db/schema';
import type { PrintConfig } from '@/services/types';

export type PrintJobStatus = PrintJobRow['status'];

/** Kept after they finish: sent jobs for 1 day, failed ones for 7 days. */
export const SENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const FAILED_RETENTION_MS = 7 * SENT_RETENTION_MS;

/** Contract: what a job left `pending` or `printing` by a closed app says. */
export const INTERRUPTED_MESSAGE = 'The app closed before this printed.';

export type JobChanges = Partial<Pick<PrintJobRow, 'status' | 'attempts' | 'error' | 'dismissed'>>;

export type PrintRepository = {
  readConfig: (apiOrigin: string, branchId: number) => Promise<PrintConfig | null>;
  saveConfig: (apiOrigin: string, config: PrintConfig, fetchedAt: string) => Promise<void>;
  /** Inserts the jobs; a first print that already exists is skipped. Returns the ids actually inserted. */
  insertJobs: (jobs: readonly PrintJobInsert[]) => Promise<string[]>;
  getJob: (id: string) => Promise<PrintJobRow | null>;
  getJobs: (ids: readonly string[]) => Promise<PrintJobRow[]>;
  /** Every job of an order (first prints and reprints), oldest first. */
  jobsForOrder: (orderUlid: string) => Promise<PrintJobRow[]>;
  /** Failed jobs not dismissed, newest first. */
  failedJobs: () => Promise<PrintJobRow[]>;
  updateJob: (id: string, changes: JobChanges, updatedAt: string) => Promise<void>;
  /** Startup: every `pending` or `printing` job becomes `failed` with `INTERRUPTED_MESSAGE`. Returns how many. */
  failInterrupted: (updatedAt: string) => Promise<number>;
  /** Deletes sent jobs older than a day and failed ones older than 7 days. Returns how many. */
  prune: (now: number) => Promise<number>;
};

function parseConfig(payload: string): PrintConfig | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== 'object' || value === null) return null;
    const config = value as PrintConfig;
    if (!config.branch || !config.settings || !Array.isArray(config.printers)) return null;
    return config;
  } catch {
    return null;
  }
}

async function readConfig(apiOrigin: string, branchId: number): Promise<PrintConfig | null> {
  const row = getDb()
    .select()
    .from(printConfig)
    .where(and(eq(printConfig.api_origin, apiOrigin), eq(printConfig.branch_id, branchId)))
    .get();
  return row ? parseConfig(row.payload) : null;
}

async function saveConfig(apiOrigin: string, config: PrintConfig, fetchedAt: string): Promise<void> {
  const row = {
    api_origin: apiOrigin,
    branch_id: config.branch.id,
    payload: JSON.stringify(config),
    generated_at: config.generated_at,
    fetched_at: fetchedAt,
  };
  getDb()
    .insert(printConfig)
    .values(row)
    .onConflictDoUpdate({
      target: [printConfig.api_origin, printConfig.branch_id],
      set: { payload: row.payload, generated_at: row.generated_at, fetched_at: row.fetched_at },
    })
    .run();
}

async function insertJobs(jobs: readonly PrintJobInsert[]): Promise<string[]> {
  if (jobs.length === 0) return [];
  const inserted: string[] = [];
  getDb().transaction((tx) => {
    for (const job of jobs) {
      // ON CONFLICT DO NOTHING covers the partial unique index: a first print is inserted once.
      const rows = tx.insert(printJobs).values(job).onConflictDoNothing().returning({ id: printJobs.id }).all();
      for (const row of rows) inserted.push(row.id);
    }
  });
  return inserted;
}

async function getJob(id: string): Promise<PrintJobRow | null> {
  return getDb().select().from(printJobs).where(eq(printJobs.id, id)).get() ?? null;
}

async function getJobs(ids: readonly string[]): Promise<PrintJobRow[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(printJobs)
    .where(inArray(printJobs.id, [...ids]))
    .all();
}

async function jobsForOrder(orderUlid: string): Promise<PrintJobRow[]> {
  return getDb()
    .select()
    .from(printJobs)
    .where(eq(printJobs.order_ulid, orderUlid))
    .orderBy(asc(printJobs.created_at), asc(printJobs.id))
    .all();
}

async function failedJobs(): Promise<PrintJobRow[]> {
  return getDb()
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.status, 'failed'), eq(printJobs.dismissed, false)))
    .orderBy(desc(printJobs.updated_at), desc(printJobs.id))
    .all();
}

async function updateJob(id: string, changes: JobChanges, updatedAt: string): Promise<void> {
  getDb()
    .update(printJobs)
    .set({ ...changes, updated_at: updatedAt })
    .where(eq(printJobs.id, id))
    .run();
}

async function failInterrupted(updatedAt: string): Promise<number> {
  const interrupted = getDb()
    .update(printJobs)
    .set({ status: 'failed', error: INTERRUPTED_MESSAGE, dismissed: false, updated_at: updatedAt })
    .where(inArray(printJobs.status, ['pending', 'printing']))
    .returning({ id: printJobs.id })
    .all();
  return interrupted.length;
}

async function prune(now: number): Promise<number> {
  const sentBefore = new Date(now - SENT_RETENTION_MS).toISOString();
  const failedBefore = new Date(now - FAILED_RETENTION_MS).toISOString();
  const removed = getDb()
    .delete(printJobs)
    .where(
      or(
        and(eq(printJobs.status, 'sent'), lt(printJobs.updated_at, sentBefore)),
        and(eq(printJobs.status, 'failed'), lt(printJobs.updated_at, failedBefore)),
      ),
    )
    .returning({ id: printJobs.id })
    .all();
  return removed.length;
}

/** The SQLite-backed repository used by the app. */
export const printRepository: PrintRepository = {
  readConfig,
  saveConfig,
  insertJobs,
  getJob,
  getJobs,
  jobsForOrder,
  failedJobs,
  updateJob,
  failInterrupted,
  prune,
};
