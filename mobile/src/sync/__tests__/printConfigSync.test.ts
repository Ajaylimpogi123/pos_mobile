/**
 * Print config sync (docs/api-contract.md → Printing → Device rules → Config):
 * `GET /print-config` cached in SQLite per branch and API origin, used
 * offline, never cleared by a failure, one run at a time.
 */
import { printRepository } from '@/db/printRepository';
import { ApiError } from '@/services/api';
import { usePrintingStore } from '@/stores/printing';
import {
  createPrintConfigSyncRunner,
  PRINT_STORAGE_ERROR_MESSAGE,
  runPrintConfigSync,
  type PrintConfigSyncDeps,
} from '@/sync/printConfigSync';
import { freshTestDatabase } from '@/test-utils/database';
import { makePrintConfig } from '@/test-utils/printing';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const ORIGIN = 'http://192.168.1.50:8000';
const NOW = Date.parse('2026-09-25T02:06:00Z');

function deps(overrides: Partial<PrintConfigSyncDeps> = {}): PrintConfigSyncDeps {
  return {
    fetchConfig: jest.fn(async () => makePrintConfig()),
    repository: printRepository,
    isOnline: jest.fn(async () => true),
    apiOrigin: ORIGIN,
    prepareDatabase: jest.fn(async () => true),
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  await freshTestDatabase();
  usePrintingStore.getState().reset();
});

describe('runPrintConfigSync', () => {
  it('fetches the config and caches it keyed by API origin and branch', async () => {
    const result = await runPrintConfigSync(deps());
    expect(result).toEqual({ outcome: 'synced', config: makePrintConfig() });
    expect(await printRepository.readConfig(ORIGIN, 1)).toEqual(makePrintConfig());
    expect(await printRepository.readConfig('http://192.168.1.99:8000', 1)).toBeNull();
    expect(await printRepository.readConfig(ORIGIN, 2)).toBeNull();
  });

  it('replaces the cached copy on the next sync', async () => {
    await runPrintConfigSync(deps());
    const renamed = makePrintConfig({ generated_at: '2026-09-25T03:00:00Z', printers: [] });
    await runPrintConfigSync(deps({ fetchConfig: async () => renamed }));
    expect(await printRepository.readConfig(ORIGIN, 1)).toEqual(renamed);
  });

  it('offline: skips the request and keeps the cache', async () => {
    await runPrintConfigSync(deps());
    const fetchConfig = jest.fn(async () => makePrintConfig({ printers: [] }));
    expect(await runPrintConfigSync(deps({ isOnline: async () => false, fetchConfig }))).toEqual({ outcome: 'offline' });
    expect(fetchConfig).not.toHaveBeenCalled();
    expect((await printRepository.readConfig(ORIGIN, 1))?.printers).toHaveLength(3);
  });

  it('a failed request never clears the cache', async () => {
    await runPrintConfigSync(deps());
    const error = new ApiError('Server Error.', { status: 500, kind: 'http' });
    expect(await runPrintConfigSync(deps({ fetchConfig: async () => Promise.reject(error) }))).toEqual({ outcome: 'error', error });
    expect(await printRepository.readConfig(ORIGIN, 1)).toEqual(makePrintConfig());
  });

  it('does nothing when the database is unavailable (no request)', async () => {
    const fetchConfig = jest.fn(async () => makePrintConfig());
    const result = await runPrintConfigSync(deps({ prepareDatabase: async () => false, fetchConfig }));
    expect(result.outcome).toBe('error');
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(result.outcome === 'error' && (result.error as Error).message).toBe(PRINT_STORAGE_ERROR_MESSAGE);
  });
});

describe('the runner', () => {
  it('runs one sync at a time (a trigger during a run joins it) and writes the result to the store', async () => {
    let resolveFetch: (value: ReturnType<typeof makePrintConfig>) => void = () => undefined;
    const fetchConfig = jest.fn(
      () =>
        new Promise<ReturnType<typeof makePrintConfig>>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const request = createPrintConfigSyncRunner(() => deps({ fetchConfig }));

    const first = request();
    const second = request();
    expect(second).toBe(first);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePrintingStore.getState().configStatus).toBe('syncing');
    resolveFetch(makePrintConfig());
    await first;

    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(usePrintingStore.getState()).toMatchObject({ configStatus: 'synced', config: makePrintConfig() });
  });

  it('keeps the loaded config on an error, with the message', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig());
    const request = createPrintConfigSyncRunner(() =>
      deps({ fetchConfig: async () => Promise.reject(new ApiError('Server Error.', { status: 500, kind: 'http' })) }),
    );
    await request();
    expect(usePrintingStore.getState()).toMatchObject({
      configStatus: 'error',
      configError: 'Server Error.',
      config: makePrintConfig(),
    });
  });
});
