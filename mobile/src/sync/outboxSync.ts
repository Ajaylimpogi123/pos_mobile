/**
 * The outbox worker (docs/api-contract.md → Offline Sales → Device rules →
 * Sync worker; PROJECT_MEMORY §8.3): sends the offline sales to
 * `POST /api/v1/sync/orders`, and (Phase 6) the shift events to their endpoints.
 *
 * - **Strictly FIFO across entities** (Shifts & Reporting → Device rules →
 *   Outbox): consecutive sales go together (≤ 50); a shift event
 *   (`shift_open`, `cash_movement`, `shift_close`) goes alone, in its place. A
 *   shift event the server rejects (a 4xx other than 401 / 408 / 429 and the
 *   "Register this tablet first." 409) goes to Needs attention, like a sale.
 * - **Single flight, FIFO:** one run at a time; batches of up to 50, oldest
 *   first. A newer sale never overtakes an older one: while the oldest pending
 *   sale is backing off, nothing is sent (unless forced by "Sync now").
 * - **Backoff** on a network error, a timeout or a `5xx`: 1 s, 2 s, 4 s, … up
 *   to 60 s, with jitter, from the attempts of the oldest sale in the batch.
 *   The app runner retries by itself when the backoff ends.
 * - **Results** (one per sale, in order):
 *   - `accepted` / `duplicate` → the local order is `synced` with the server's
 *     `Order`, and its outbox row is removed (one transaction).
 *   - `rejected` → `needs_attention` with the message. Never deleted; Retry re-queues it.
 * - **`409` "Register this tablet first."** → register the device, then send
 *   the batch again (once per run).
 * - **`401`** → stop. The shared client signs out; the outbox is **kept**
 *   (through logout and user switches) and the worker waits for a sign-in.
 * - Offline (expo-network) → nothing is sent.
 *
 * `runOutboxSync` is pure apart from its `deps`, so the rules are unit tested
 * with a real SQLite repository and a mocked sender. `requestOutboxSync` is
 * the app entry point every trigger calls.
 */
import { prepareDatabase } from '@/db/database';
import {
  isOrderEntry,
  offlineRepository,
  type OfflineRepository,
  type OrderOutboxEntry,
  type ShiftEventEntry,
} from '@/db/offlineRepository';
import { getErrorMessage, isApiError } from '@/services/api';
import { closeShift, createCashMovement, openShift } from '@/services/shifts';
import { syncOrders } from '@/services/sync';
import type { RegisteredDevice, SyncOrderResult, SyncOrdersRequest } from '@/services/types';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { isDeviceOnline } from '@/sync/catalogueSync';
import { registerThisDevice } from '@/sync/deviceRegistration';
import { isoSeconds } from '@/sale/localOrder';

/** Contract: at most 50 orders per `POST /sync/orders`. */
export const OUTBOX_BATCH_SIZE = 50;
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

/** A result that is missing or malformed for a sale that was sent. */
export const MISSING_RESULT_MESSAGE = "The server didn't answer for this sale. It will be sent again.";
/** A `rejected` result without a message. */
export const REJECTED_FALLBACK_MESSAGE = 'The server could not store this sale.';

/**
 * The wait before the next attempt, after `attempts` failed ones (≥ 1):
 * `1 s × 2^(attempts − 1)` capped at 60 s, then ±25 % jitter, kept within 1–60 s.
 */
export function backoffDelay(attempts: number, random: () => number): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 16);
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** exponent);
  const jittered = Math.round(base * (0.75 + random() * 0.5));
  return Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, jittered));
}

export type OutboxSyncDeps = {
  repository: Pick<
    OfflineRepository,
    'nextBatch' | 'nextAttemptAt' | 'markSynced' | 'completeShiftEvent' | 'markRejected' | 'deferRows' | 'countOutbox'
  >;
  send: (body: SyncOrdersRequest) => Promise<SyncOrderResult[]>;
  /** Phase 6: sends one shift event to its endpoint (resolves on a 2xx). */
  sendShiftEvent: (entry: ShiftEventEntry) => Promise<void>;
  /** `POST /devices/register` (binds the token); `null` when it failed. */
  register: () => Promise<RegisteredDevice | null>;
  isOnline: () => Promise<boolean>;
  isSignedIn: () => boolean;
  prepareDatabase: () => Promise<boolean>;
  now: () => number;
  random: () => number;
  /** Called after every batch that changed the stored sales (screens refresh). */
  onChange?: () => void;
};

export type OutboxSyncTotals = { sent: number; synced: number; rejected: number };

export type OutboxSyncResult =
  /** Everything due was sent (or nothing was pending). `retryAt`: the oldest pending sale is still backing off. */
  | ({ outcome: 'done'; retryAt: string | null } & OutboxSyncTotals)
  | { outcome: 'offline' }
  /** Not signed in, or a `401`: the outbox is kept until someone signs in. */
  | { outcome: 'stopped' }
  /** The run stopped on an error; `retryAt` when the sales were deferred (network, 5xx, …). */
  | ({ outcome: 'error'; error: unknown; retryAt: string | null } & OutboxSyncTotals);

export type OutboxSyncOptions = {
  /** "Sync now": send the oldest pending sales even while they are backing off. */
  force?: boolean;
};

function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

function needsRegistration(error: unknown): boolean {
  return isApiError(error) && error.status === 409;
}

/** Contract: the `409` of a token that isn't bound to a device. */
export const REGISTER_FIRST_MESSAGE = 'Register this tablet first.';

/** A shift endpoint's `409 "Register this tablet first."` (another `409`, e.g. another tablet's shift, is a rejection). */
function shiftEventNeedsRegistration(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.message.trim() === REGISTER_FIRST_MESSAGE;
}

/**
 * A shift event the server **rejected**: a 4xx answer that trying again won't
 * change (422, 403, 404, another 409). It goes to Needs attention, like a
 * rejected sale. 401, 408 and 429 are not rejections, and neither are network
 * errors, timeouts and 5xx (those back off and retry).
 */
function isShiftEventRejection(error: unknown): boolean {
  if (!isApiError(error) || error.kind !== 'http' || error.status === null) return false;
  if (error.status < 400 || error.status >= 500) return false;
  return error.status !== 401 && error.status !== 408 && error.status !== 429;
}

/** Phase 6: sends one shift event to its endpoint (`@/services/shifts`). */
export async function sendShiftEvent(entry: ShiftEventEntry): Promise<void> {
  switch (entry.entity) {
    case 'shift_open':
      await openShift(entry.payload.body);
      return;
    case 'cash_movement':
      await createCashMovement(entry.payload.shift_ulid, entry.payload.body);
      return;
    case 'shift_close':
      await closeShift(entry.payload.shift_ulid, entry.payload.body);
      return;
  }
}

/** Applies one batch's results. Returns the ulids that got no usable result (sent again later). */
async function applyResults(
  deps: OutboxSyncDeps,
  batch: readonly OrderOutboxEntry[],
  results: readonly SyncOrderResult[],
  totals: OutboxSyncTotals,
): Promise<string[]> {
  // A body that isn't a list counts as "no results": every sale is sent again later.
  const list: readonly SyncOrderResult[] = Array.isArray(results) ? results : [];
  const byUlid = new Map<string, SyncOrderResult>();
  for (const result of list) {
    if (result && typeof result.ulid === 'string') byUlid.set(result.ulid, result);
  }
  const unanswered: string[] = [];
  const now = isoSeconds(deps.now());

  for (const [index, entry] of batch.entries()) {
    // "In the same order": the result at the same position, checked by its ulid.
    const positional = list[index];
    const result = positional && positional.ulid === entry.ulid ? positional : byUlid.get(entry.ulid);
    if (result && (result.status === 'accepted' || result.status === 'duplicate') && result.order) {
      await deps.repository.markSynced(entry.ulid, result.order, now);
      totals.synced += 1;
    } else if (result && result.status === 'rejected') {
      const message = result.message?.trim() ? result.message : REJECTED_FALLBACK_MESSAGE;
      await deps.repository.markRejected(entry.ulid, message, now);
      totals.rejected += 1;
    } else {
      unanswered.push(entry.ulid);
    }
  }
  return unanswered;
}

/** One run: batches until nothing is due. Never throws. */
export async function runOutboxSync(deps: OutboxSyncDeps, options: OutboxSyncOptions = {}): Promise<OutboxSyncResult> {
  const totals: OutboxSyncTotals = { sent: 0, synced: 0, rejected: 0 };
  let reregistered = false;

  try {
    if (!(await deps.prepareDatabase())) {
      return { outcome: 'error', error: new Error('The on-device database is unavailable.'), retryAt: null, ...totals };
    }
    if (!deps.isSignedIn()) return { outcome: 'stopped' };
    if (!(await deps.isOnline())) return { outcome: 'offline' };

    let force = options.force ?? false;
    for (;;) {
      const batch = await deps.repository.nextBatch(OUTBOX_BATCH_SIZE, isoSeconds(deps.now()), force);
      if (batch.length === 0) {
        const retryAt = await deps.repository.nextAttemptAt();
        return { outcome: 'done', retryAt, ...totals };
      }

      const first = batch[0];
      if (!isOrderEntry(first)) {
        // Phase 6: a shift event goes alone, to its own endpoint, in its FIFO place.
        try {
          await deps.sendShiftEvent(first);
        } catch (error) {
          if (isUnauthorized(error)) return { outcome: 'stopped' };
          if (shiftEventNeedsRegistration(error) && !reregistered) {
            reregistered = true;
            if (await deps.register()) {
              force = true;
              continue;
            }
          }
          if (isShiftEventRejection(error) && !shiftEventNeedsRegistration(error)) {
            await deps.repository.markRejected(first.ulid, getErrorMessage(error), isoSeconds(deps.now()));
            totals.sent += 1;
            totals.rejected += 1;
            deps.onChange?.();
            force = true;
            continue;
          }
          const delay = backoffDelay(first.attempts + 1, deps.random);
          const retryAt = isoSeconds(deps.now() + delay);
          await deps.repository.deferRows([first.ulid], retryAt, getErrorMessage(error));
          deps.onChange?.();
          return { outcome: 'error', error, retryAt, ...totals };
        }
        await deps.repository.completeShiftEvent(first.ulid);
        totals.sent += 1;
        totals.synced += 1;
        deps.onChange?.();
        force = true;
        continue;
      }

      const orders = batch.filter(isOrderEntry);
      let results: SyncOrderResult[];
      try {
        results = await deps.send({ orders: orders.map((entry) => entry.payload) });
      } catch (error) {
        if (isUnauthorized(error)) return { outcome: 'stopped' };
        if (needsRegistration(error) && !reregistered) {
          // "Register this tablet first.": bind the token to this device, then send the batch again.
          reregistered = true;
          if (await deps.register()) {
            force = true;
            continue;
          }
        }
        const delay = backoffDelay(batch[0].attempts + 1, deps.random);
        const retryAt = isoSeconds(deps.now() + delay);
        await deps.repository.deferRows(
          batch.map((entry) => entry.ulid),
          retryAt,
          getErrorMessage(error),
        );
        deps.onChange?.();
        return { outcome: 'error', error, retryAt, ...totals };
      }

      totals.sent += batch.length;
      const unanswered = await applyResults(deps, orders, results, totals);
      deps.onChange?.();
      if (unanswered.length > 0) {
        const delay = backoffDelay(batch[0].attempts + 1, deps.random);
        const retryAt = isoSeconds(deps.now() + delay);
        await deps.repository.deferRows(unanswered, retryAt, MISSING_RESULT_MESSAGE);
        return { outcome: 'error', error: new Error(MISSING_RESULT_MESSAGE), retryAt, ...totals };
      }
      // Everything in this batch was answered: the next batch is due by definition (it was queued behind it).
      force = true;
    }
  } catch (error) {
    return { outcome: 'error', error, retryAt: null, ...totals };
  }
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

/** Re-reads the outbox counts into the store. Never rejects. */
export async function refreshOutboxCounts(repository: Pick<OfflineRepository, 'countOutbox'> = offlineRepository): Promise<void> {
  try {
    if (!(await prepareDatabase())) return;
    useOfflineStore.getState().setCounts(await repository.countOutbox());
  } catch {
    // The pill keeps its last counts.
  }
}

/**
 * Wraps `runOutboxSync` for the app:
 * - one run at a time; a trigger during a run makes it run once more at the
 *   end (so a sale saved mid-run isn't left waiting for the next trigger);
 * - the status and counts go to the offline store;
 * - after a backoff, a timer runs it again when the oldest sale is due.
 */
export function createOutboxSyncRunner(getDeps: () => OutboxSyncDeps) {
  let inFlight: Promise<OutboxSyncResult> | null = null;
  let again: OutboxSyncOptions | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(retryAt: string | null, deps: OutboxSyncDeps) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!retryAt) return;
    const delay = Math.max(0, Date.parse(retryAt) - deps.now());
    timer = setTimeout(() => {
      timer = null;
      void request();
    }, Math.min(delay, BACKOFF_MAX_MS));
  }

  async function run(options: OutboxSyncOptions): Promise<OutboxSyncResult> {
    const deps = getDeps();
    const store = useOfflineStore.getState();
    store.startSync();
    let result: OutboxSyncResult;
    try {
      result = await runOutboxSync(deps, options);
    } finally {
      await refreshOutboxCounts(deps.repository);
    }
    if (result.outcome === 'error') {
      useOfflineStore.getState().finishSync(getErrorMessage(result.error));
      schedule(result.retryAt, deps);
    } else {
      useOfflineStore.getState().finishSync(null);
      schedule(result.outcome === 'done' ? result.retryAt : null, deps);
    }
    return result;
  }

  function request(options: OutboxSyncOptions = {}): Promise<OutboxSyncResult> {
    if (inFlight) {
      again = { force: Boolean(again?.force || options.force) };
      return inFlight;
    }
    inFlight = run(options).finally(() => {
      inFlight = null;
      if (again) {
        const next = again;
        again = null;
        void request(next);
      }
    });
    return inFlight;
  }

  return request;
}

function appDeps(): OutboxSyncDeps {
  return {
    repository: offlineRepository,
    send: syncOrders,
    sendShiftEvent,
    register: registerThisDevice,
    isOnline: isDeviceOnline,
    isSignedIn: () => useSessionStore.getState().status === 'signedIn',
    prepareDatabase,
    now: Date.now,
    random: Math.random,
    onChange: () => useOfflineStore.getState().markLocalChanged(),
  };
}

/**
 * Sends the outbox now, or joins the run in progress. Triggers: reconnect,
 * foreground, login and restore, the 5-minute timer, right after each offline
 * sale, and "Sync now" (`{ force: true }`). Never rejects.
 */
export const requestOutboxSync = createOutboxSyncRunner(appDeps);
