import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit: generates the on-device SQLite migrations from `src/db/schema.ts`.
 * Run `npx drizzle-kit generate --name <change>` after changing the schema; the app
 * applies the bundled migrations at startup (`src/db/database.ts`).
 */
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
