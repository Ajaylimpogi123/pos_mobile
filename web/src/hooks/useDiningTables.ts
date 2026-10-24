/**
 * Dine-in Tables & Tabs (v1.26): whether dine-in is on, the admin tables
 * (§B, `settings.manage`) and the Tables view (§C, `sale.create`).
 *
 * - `useDineIn` reads `GET /print-config`'s `settings` (any signed-in user),
 *   which a Settings save refreshes.
 * - The Tables view polls every 15 s while it is shown (and the browser tab is
 *   visible), and after every tab action (`invalidateTables`).
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { usePrintConfig } from '@/hooks/usePrintConfig';
import { createTable, deleteTable, listAdminTables, listTables, updateTable } from '@/services/tables';
import type { DiningTableCreateRequest, DiningTableUpdateRequest } from '@/services/types';

/** §C: the clients poll the Tables view this often while it is open. */
export const TABLES_POLL_MS = 15_000;

export const tableKeys = {
  admin: ['admin', 'tables'] as const,
  adminList: ['admin', 'tables', 'list'] as const,
  view: ['tables', 'view'] as const,
};

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

/** After every tab action: the Tables view reloads now. */
export function invalidateTables(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: tableKeys.view });
}
