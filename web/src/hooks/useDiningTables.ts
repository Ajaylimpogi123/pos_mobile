/**
 * Dine-in Tables & Tabs (v1.26): whether dine-in is on, the admin tables
 * (§B, `settings.manage`) and the Tables view (§C, `sale.create`).
 *
 * - `useDineIn` reads `GET /print-config`'s `settings` (any signed-in user),
 *   which a Settings save refreshes.
 * - The Tables view polls every 15 s while it is shown (and the browser tab is
 *   visible), and after every tab action (`invalidateTables`).
 * - Table Management (v1.29): every admin table (the floor plan editor needs
 *   whole areas), the layout save (§B) and the status board summary (§D,
 *   polled like the Tables view).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { usePrintConfig } from '@/hooks/usePrintConfig';
import { getErrorMessage } from '@/services/api';
import {
  createTable,
  deleteTable,
  getTablesSummary,
  listAdminTables,
  listTables,
  saveTableLayout,
  updateTable,
} from '@/services/tables';
import type { DiningTable, DiningTableCreateRequest, DiningTableUpdateRequest, TableLayoutRequest } from '@/services/types';

/** §C: the clients poll the Tables view this often while it is open. */
export const TABLES_POLL_MS = 15_000;

export const tableKeys = {
  admin: ['admin', 'tables'] as const,
  adminList: ['admin', 'tables', 'list'] as const,
  view: ['tables', 'view'] as const,
  adminAll: ['admin', 'tables', 'all'] as const,
  summary: ['tables', 'summary'] as const,
};

/** A safety cap on the pages read for the floor plan editor (100 tables each). */
const MAX_ADMIN_PAGES = 20;

/** Dine-in on/off and the service charge, from the print config (`false` / 0 until it loads). */
export function useDineIn() {
  const { config, loading } = usePrintConfig();
  return {
    enabled: config?.settings.dine_in_enabled ?? false,
    serviceChargeBps: config?.settings.service_charge_bps ?? 0,
    loading,
  };
}

export function useAdminTableList() {
  return useCursorList(tableKeys.adminList, (cursor) => listAdminTables({ cursor, per_page: 100 }));
}

function invalidateAdmin(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: tableKeys.admin });
  void queryClient.invalidateQueries({ queryKey: tableKeys.view });
}

/** Create (`id` null) or update a table. */
export function useSaveTable(id: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DiningTableCreateRequest | DiningTableUpdateRequest) =>
      id === null ? createTable(body as DiningTableCreateRequest) : updateTable(id, body),
    onSuccess: () => invalidateAdmin(queryClient),
  });
}

export function useSetTableActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => updateTable(id, { is_active: active }),
    onSuccess: () => invalidateAdmin(queryClient),
  });
}

export function useDeleteTable() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteTable(id), onSuccess: () => invalidateAdmin(queryClient) });
}

/** §C: the active tables with their open tab; polled while `enabled`. */
export function useTablesView(enabled: boolean) {
  return useCursorList(tableKeys.view, (cursor) => listTables({ cursor, per_page: 100 }), {
    enabled,
    refetchInterval: enabled ? TABLES_POLL_MS : false,
  });
}

/** After every tab action: the Tables view (and the board's figures) reload now. */
export function invalidateTables(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: tableKeys.view });
  void queryClient.invalidateQueries({ queryKey: tableKeys.summary });
}

/** Every admin table (all cursor pages): the floor plan editor checks a whole area at once. */
async function listAllAdminTables(): Promise<DiningTable[]> {
  const tables: DiningTable[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ADMIN_PAGES; page += 1) {
    const response = await listAdminTables({ cursor, per_page: 100 });
    tables.push(...response.data);
    if (!response.meta.next_cursor) break;
    cursor = response.meta.next_cursor;
  }
  return tables;
}

export function useAllAdminTables() {
  const query = useQuery({ queryKey: tableKeys.adminAll, queryFn: listAllAdminTables });
  return {
    tables: query.data ?? null,
    loading: query.isPending,
    error: query.isError && !query.data ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** §B: PUT /admin/tables/layout. On success the admin lists and the Tables view reload. */
export function useSaveTableLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TableLayoutRequest) => saveTableLayout(body),
    onSuccess: () => invalidateAdmin(queryClient),
  });
}

/** §D: the status board figures (`report.view`), polled every 15 s while `enabled`. */
export function useTablesSummary(enabled: boolean) {
  const query = useQuery({
    queryKey: tableKeys.summary,
    queryFn: getTablesSummary,
    enabled,
    refetchInterval: enabled ? TABLES_POLL_MS : false,
  });
  return {
    summary: query.data ?? null,
    loading: enabled && query.isPending,
    error: query.isError && !query.data ? query.error : null,
    reload: () => void query.refetch(),
  };
}
