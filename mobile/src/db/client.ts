/**
 * The on-device SQLite database (expo-sqlite + Drizzle). Opened lazily on
 * first use, so importing this module has no side effects (and tests can
 * replace it with `jest.mock('@/db/client')`).
 */
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from '@/db/schema';

/** File name of the app's SQLite database (in expo-sqlite's default directory). */
export const DATABASE_NAME = 'pos.db';

export type AppDatabase = ExpoSQLiteDatabase<typeof schema>;

let database: AppDatabase | null = null;

/** The shared Drizzle database. Migrations run once at startup (`prepareDatabase`). */
export function getDb(): AppDatabase {
  if (!database) database = drizzle(openDatabaseSync(DATABASE_NAME), { schema });
  return database;
}
