/**
 * Test-only: a real, in-memory SQLite database for the app's Drizzle code.
 * Never import from app code.
 *
 * expo-sqlite is a native module and can't run under Jest, so this adapts
 * Node's built-in `node:sqlite` (Node 22.13+ / 24) to the small part of
 * expo-sqlite's synchronous API that Drizzle's `expo-sqlite` driver calls
 * (`prepareSync` → `executeSync` / `executeForRawResultSync`). The app's own
 * schema, generated migrations and queries then run against a genuine SQLite
 * engine: ordering, `COLLATE NOCASE`, `LIKE … ESCAPE`, joins and transactions
 * behave exactly as on the device. (Node prints a one-line ExperimentalWarning
 * when `node:sqlite` loads; it is harmless.)
 *
 * Usage in a test file:
 *   jest.mock('@/db/client', () => ({ getDb: () => require('@/test-utils/database').currentTestDatabase() }));
 *   beforeEach(async () => { await freshTestDatabase(); });
 */
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { AppDatabase } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import * as schema from '@/db/schema';

/** The part of `node:sqlite` used here (typed locally: the app's tsconfig doesn't load Node's global types). */
type Params = (string | number | bigint | null | Uint8Array)[];
type NodeStatement = {
  columns: () => unknown[];
  setReturnArrays: (enabled: boolean) => void;
  all: (...params: Params) => unknown[];
  run: (...params: Params) => { changes: number | bigint; lastInsertRowid: number | bigint };
};
type NodeDatabase = {
  prepare: (source: string) => NodeStatement;
  exec: (source: string) => void;
  close: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDatabase };

function toParams(params: unknown): Params {
  return (Array.isArray(params) ? params : []) as Params;
}

/** The expo-sqlite surface Drizzle's driver uses, backed by `node:sqlite`. */
function adapt(nodeDb: NodeDatabase): SQLiteDatabase {
  const adapter = {
    prepareSync(source: string) {
      const statement = nodeDb.prepare(source);
      const returnsRows = statement.columns().length > 0;

      return {
        executeSync(params: unknown) {
          if (returnsRows) {
            statement.setReturnArrays(false);
            const rows = statement.all(...toParams(params));
            return { changes: 0, lastInsertRowId: 0, getAllSync: () => rows, getFirstSync: () => rows[0] ?? null };
          }
          const result = statement.run(...toParams(params));
          return {
            changes: Number(result.changes),
            lastInsertRowId: Number(result.lastInsertRowid),
            getAllSync: () => [],
            getFirstSync: () => null,
          };
        },
        executeForRawResultSync(params: unknown) {
          statement.setReturnArrays(true);
          const rows = statement.all(...toParams(params));
          statement.setReturnArrays(false);
          return { getAllSync: () => rows, getFirstSync: () => rows[0] ?? null };
        },
        finalizeSync() {},
      };
    },
    execSync(source: string) {
      nodeDb.exec(source);
    },
    closeSync() {
      nodeDb.close();
    },
  };
  return adapter as unknown as SQLiteDatabase;
}

let current: AppDatabase | null = null;

/** A new empty in-memory database with the app's migrations applied. It becomes `currentTestDatabase()`. */
export async function freshTestDatabase(): Promise<AppDatabase> {
  const db = drizzle(adapt(new DatabaseSync(':memory:')), { schema });
  await migrate(db, migrations);
  current = db;
  return db;
}

/** The database `@/db/client` returns in tests that mock it (see the usage note above). */
export function currentTestDatabase(): AppDatabase {
  if (!current) throw new Error('Call freshTestDatabase() in beforeEach first.');
  return current;
}
