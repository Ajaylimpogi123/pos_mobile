/**
 * Hardening & Pilot (Phase 8) §F: sends the queued app errors to
 * `POST /api/v1/client-errors`.
 *
 * - Batches of 20, oldest first. A batch the server took (202) is deleted.
 * - A 429, a network error, a timeout or a 5xx keeps the entries and stops the run.
 * - A 422 (a malformed body: it would never be accepted) drops that batch.
 * - Errors held in memory (database not ready) move to SQLite first; when the
 *   database failed, they are sent straight from memory.
 * - Single flight: a call during a run joins it. Auth is optional, so it runs
 *   signed out too (a crash can happen before login).
 *
 * Triggered with the sync worker (`useDeviceHealthTriggers`): at launch, in
 * the foreground, every 5 minutes, when the connection comes back, and by
 * "Send now" / "Send diagnostics" on "This tablet".
 */
import { prepareDatabase } from '@/db/database';
import { errorQueueRepository, type ErrorQueueRepository } from '@/db/errorQueueRepository';
import {
  memoryErrorCount,
  refreshErrorsPending,
  returnMemoryErrors,
  takeMemoryErrors,
} from '@/errors/capture';
import { isApiValidationError } from '@/services/api';
import { reportClientErrors } from '@/services/clientErrors';
import type { ClientError, ClientErrorsAccepted, ClientErrorsRequest } from '@/services/types';
import { isDeviceOnline } from '@/sync/catalogueSync';

/** §F: errors per `POST /client-errors` (the contract allows 1..20). */
export const ERROR_BATCH_SIZE = 20;
/** At most this many batches per run (the whole 200-entry queue). */
const MAX_BATCHES = 10;

export type ErrorFlushDeps = {
  repository: Pick<ErrorQueueRepository, 'enqueue' | 'nextBatch' | 'remove'>;
  send: (body: ClientErrorsRequest) => Promise<ClientErrorsAccepted>;
  isOnline: () => Promise<boolean>;
  prepareDatabase: () => Promise<boolean>;
  now: () => number;
};

export type ErrorFlushResult = { outcome: 'done' | 'offline' | 'kept'; sent: number };

async function sendBatch(deps: ErrorFlushDeps, batch: readonly ClientError[]): Promise<'sent' | 'dropped' | 'kept'> {
  try {
    await deps.send({ errors: [...batch] });
    return 'sent';
  } catch (error) {
    return isApiValidationError(error) ? 'dropped' : 'kept';
  }
}

/** One run. Never throws. */
export async function runErrorFlush(deps: ErrorFlushDeps): Promise<ErrorFlushResult> {
  let sent = 0;
  let dbReady = false;
  try {
    dbReady = await deps.prepareDatabase();
    if (dbReady && memoryErrorCount() > 0) {
      const held = takeMemoryErrors();
      try {
        await deps.repository.enqueue(held, new Date(deps.now()).toISOString());
      } catch {
        returnMemoryErrors(held);
      }
    }
    if (!(await deps.isOnline())) return { outcome: 'offline', sent };

    for (let round = 0; round < MAX_BATCHES; round += 1) {
      if (dbReady) {
        const batch = await deps.repository.nextBatch(ERROR_BATCH_SIZE);
        if (batch.length === 0) return { outcome: 'done', sent };
        const result = await sendBatch(deps, batch);
        if (result === 'kept') return { outcome: 'kept', sent };
        await deps.repository.remove(batch.map((entry) => entry.ulid));
        if (result === 'sent') sent += batch.length;
      } else {
        const held = takeMemoryErrors();
        if (held.length === 0) return { outcome: 'done', sent };
        const batch = held.slice(0, ERROR_BATCH_SIZE);
        returnMemoryErrors(held.slice(ERROR_BATCH_SIZE));
        const result = await sendBatch(deps, batch);
        if (result === 'kept') {
          returnMemoryErrors(batch);
          return { outcome: 'kept', sent };
        }
        if (result === 'sent') sent += batch.length;
      }
    }
    return { outcome: 'done', sent };
  } catch {
    return { outcome: 'kept', sent };
  } finally {
    await refreshErrorsPending(dbReady);
  }
}

function appDeps(): ErrorFlushDeps {
  return {
    repository: errorQueueRepository,
    send: reportClientErrors,
    isOnline: isDeviceOnline,
    prepareDatabase,
    now: Date.now,
  };
}

let inFlight: Promise<ErrorFlushResult> | null = null;

/** Sends the error queue now, or joins the run in progress. Never rejects. */
export function requestErrorFlush(): Promise<ErrorFlushResult> {
  if (inFlight) return inFlight;
  inFlight = runErrorFlush(appDeps()).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
