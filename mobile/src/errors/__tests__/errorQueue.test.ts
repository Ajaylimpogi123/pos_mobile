/**
 * Hardening & Pilot (Phase 8) §F: capture → redaction → the SQLite
 * `error_queue` (≤ 200, oldest dropped) → `POST /client-errors` in batches of
 * 20; a 429 or network error keeps the entries, a 422 drops the batch.
 */
import { errorQueueRepository, ERROR_QUEUE_LIMIT } from '@/db/errorQueueRepository';
import { captureError, memoryErrorCount, resetErrorCaptureForTests } from '@/errors/capture';
import { ERROR_BATCH_SIZE, runErrorFlush, type ErrorFlushDeps } from '@/errors/errorQueue';
import { ApiError, ApiValidationError } from '@/services/api';
import type { ClientError, ClientErrorsRequest } from '@/services/types';
import { useDiagnosticsStore } from '@/stores/diagnostics';
import { useSyncStore } from '@/stores/sync';
import { freshTestDatabase } from '@/test-utils/database';
import { createUlidFactory } from '@/utils/ulid';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const T0 = Date.parse('2026-10-12T02:00:00Z');
const nextUlid = createUlidFactory({ now: () => T0 });

function clientError(message: string): ClientError {
  return { ulid: nextUlid(), occurred_at: new Date(T0).toISOString(), level: 'error', message, stack: null, context: {} };
}

function deps(overrides: Partial<ErrorFlushDeps> = {}): ErrorFlushDeps & { send: jest.Mock } {
  return {
    repository: errorQueueRepository,
    send: jest.fn(async (body: ClientErrorsRequest) => ({ accepted: body.errors.length, duplicates: 0 })),
    isOnline: async () => true,
    prepareDatabase: async () => true,
    now: () => T0,
    ...overrides,
  } as ErrorFlushDeps & { send: jest.Mock };
}

beforeEach(async () => {
  await freshTestDatabase();
  resetErrorCaptureForTests();
  useSyncStore.getState().reset();
  useDiagnosticsStore.getState().reset();
});

describe('error_queue', () => {
  it('keeps at most 200 entries, dropping the oldest', async () => {
    const all = Array.from({ length: ERROR_QUEUE_LIMIT + 15 }, (_, index) => clientError(`E${index}`));
    for (const error of all) await errorQueueRepository.enqueue([error], error.occurred_at);
    expect(await errorQueueRepository.count()).toBe(ERROR_QUEUE_LIMIT);
    const [first] = await errorQueueRepository.nextBatch(1);
    expect(first.message).toBe('E15');
  });
});

describe('captureError', () => {
  it('redacts, de-duplicates within 60 s and stores in SQLite once the database is ready', async () => {
    useSyncStore.getState().setDatabaseReady(null);
    // One call site, so the same top frame (the local fingerprint is message + top frame).
    const fail = () => new Error('Login failed for password=hunter22');
    captureError(fail(), { now: T0 });
    captureError(fail(), { now: T0 + 10_000 });
    captureError(fail(), { now: T0 + 61_000 });

    const stored = await errorQueueRepository.nextBatch(10);
    expect(stored).toHaveLength(2);
    expect(stored[0].message).not.toContain('hunter22');
    expect(stored[0].level).toBe('error');
    expect(stored[0].context.os).toBeDefined();
  });

  it('holds errors in memory while the database is not ready', async () => {
    captureError(new Error('before migrations'), { now: T0 });
    expect(memoryErrorCount()).toBe(1);
    expect(await errorQueueRepository.count()).toBe(0);
  });
});

describe('runErrorFlush', () => {
  it('sends batches of 20 and removes what the server took', async () => {
    for (let index = 0; index < 45; index += 1) {
      const error = clientError(`E${index}`);
      await errorQueueRepository.enqueue([error], error.occurred_at);
    }
    const worker = deps();
    const result = await runErrorFlush(worker);

    expect(result).toEqual({ outcome: 'done', sent: 45 });
    expect(worker.send.mock.calls.map(([body]) => (body as ClientErrorsRequest).errors.length)).toEqual([ERROR_BATCH_SIZE, ERROR_BATCH_SIZE, 5]);
    expect(await errorQueueRepository.count()).toBe(0);
  });

  it.each([
    ['429', new ApiError('Too Many Attempts.', { status: 429, kind: 'http' })],
    ['network', new ApiError("Can't reach the server.", { status: null, kind: 'network' })],
    ['5xx', new ApiError('Server Error.', { status: 500, kind: 'http' })],
  ])('keeps the entries on a %s', async (_label, failure) => {
    const error = clientError('kept');
    await errorQueueRepository.enqueue([error], error.occurred_at);
    const result = await runErrorFlush(deps({ send: jest.fn(async () => Promise.reject(failure)) }));
    expect(result.outcome).toBe('kept');
    expect(await errorQueueRepository.count()).toBe(1);
  });

  it('drops a batch the server rejects as malformed (422)', async () => {
    const error = clientError('malformed');
    await errorQueueRepository.enqueue([error], error.occurred_at);
    const result = await runErrorFlush(deps({ send: jest.fn(async () => Promise.reject(new ApiValidationError('Invalid.', {}))) }));
    expect(result.outcome).toBe('done');
    expect(await errorQueueRepository.count()).toBe(0);
  });

  it('sends nothing offline, but moves memory errors into SQLite', async () => {
    captureError(new Error('early crash'), { now: T0 });
    const worker = deps({ isOnline: async () => false });
    const result = await runErrorFlush(worker);
    expect(result.outcome).toBe('offline');
    expect(worker.send).not.toHaveBeenCalled();
    expect(memoryErrorCount()).toBe(0);
    expect(await errorQueueRepository.count()).toBe(1);
    expect(useDiagnosticsStore.getState().errorsPending).toBe(1);
  });

  it('sends memory errors directly when the database is unavailable', async () => {
    captureError(new Error('migration failed'), { now: T0 });
    const worker = deps({ prepareDatabase: async () => false });
    const result = await runErrorFlush(worker);
    expect(result).toEqual({ outcome: 'done', sent: 1 });
    expect(memoryErrorCount()).toBe(0);
  });
});
