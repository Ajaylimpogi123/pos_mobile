/**
 * TanStack Query keys for Dine-in Tables & Tabs. A sign-out clears the cache anyway.
 */
const root = ['dine-in'] as const;

export const tableKeys = {
  all: root,
  adminTables: () => [...root, 'admin-tables'] as const,
  tablesView: () => [...root, 'tables'] as const,
  tabs: () => [...root, 'tabs'] as const,
  tab: (ulid: string) => [...root, 'tabs', ulid] as const,
};
