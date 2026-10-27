/**
 * TanStack Query keys for Dine-in Tables & Tabs and Table Management. A sign-out clears the cache anyway.
 */
const root = ['dine-in'] as const;

export const tableKeys = {
  all: root,
  adminTables: () => [...root, 'admin-tables'] as const,
  /** Table Management §B: every admin table (all pages), for the floor plan editor. */
  floorPlan: () => [...root, 'admin-tables', 'floor-plan'] as const,
  tablesView: () => [...root, 'tables'] as const,
  /** Table Management §D: GET /tables/summary. */
  summary: () => [...root, 'tables-summary'] as const,
  /** Table Management §E: GET /reservations for one business day (and optional status). */
  reservations: () => [...root, 'reservations'] as const,
  reservationsFor: (date: string, status: string | null = null) => [...root, 'reservations', date, status] as const,
  tabs: () => [...root, 'tabs'] as const,
  tab: (ulid: string) => [...root, 'tabs', ulid] as const,
};
