/**
 * Printers & receipt settings (Printing → Admin, permission `settings.manage`).
 * Every change also refreshes `GET /print-config`, which the terminal prints from.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { printConfigKey } from '@/hooks/usePrintConfig';
import { getErrorMessage } from '@/services/api';
import { listAdminCategories, listCategories } from '@/services/catalog';
import {
  createPrinter,
  deletePrinter,
  getAdminPrinter,
  getBranchSettings,
  listAdminPrinters,
  updateBranchSettings,
  updatePrinter,
} from '@/services/printers';
import type { BranchSettingsUpdateRequest, Category, CursorPage, PrinterCreateRequest, PrinterUpdateRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

export const printerKeys = {
  all: ['admin', 'printers'] as const,
  list: ['admin', 'printers', 'list'] as const,
  detail: (id: number) => ['admin', 'printers', 'detail', id] as const,
  settings: ['admin', 'settings'] as const,
  categories: (admin: boolean) => ['printers', 'route-categories', admin] as const,
};

export function usePrinterList() {
  return useCursorList(printerKeys.list, (cursor) => listAdminPrinters({ cursor, per_page: 100 }));
}

export function usePrinter(id: number | null) {
  const query = useQuery({
    queryKey: printerKeys.detail(id ?? 0),
    queryFn: () => getAdminPrinter(id as number),
    enabled: id !== null,
  });
  return {
    printer: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

function useInvalidatePrinting() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: printerKeys.all });
    void queryClient.invalidateQueries({ queryKey: printConfigKey });
  };
}

export function useSavePrinter(id: number | null) {
  const invalidate = useInvalidatePrinting();
  return useMutation({
    mutationFn: (body: PrinterCreateRequest | PrinterUpdateRequest) =>
      id === null ? createPrinter(body as PrinterCreateRequest) : updatePrinter(id, body),
    onSuccess: invalidate,
  });
}

export function useDeletePrinter() {
  const invalidate = useInvalidatePrinting();
  return useMutation({ mutationFn: (id: number) => deletePrinter(id), onSuccess: invalidate });
}

async function readAllCategories(fetchPage: (cursor: string | undefined) => Promise<CursorPage<Category>>): Promise<Category[]> {
  const items: Category[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return items;
}

/**
 * The categories a printer can be routed to: every non-deleted category
 * (`GET /admin/categories`, inactive ones too) for a user with
 * `product.manage`, otherwise the active ones (`GET /categories`).
 */
export function useRoutableCategories() {
  const user = useSessionStore((state) => state.user);
  const admin = hasPermission(user, PERMISSIONS.productManage);
  const query = useQuery({
    queryKey: printerKeys.categories(admin),
    queryFn: () => readAllCategories((cursor) => (admin ? listAdminCategories({ cursor, per_page: 100 }) : listCategories({ cursor, per_page: 100 }))),
  });
  return {
    categories: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export function useBranchSettings() {
  const query = useQuery({ queryKey: printerKeys.settings, queryFn: getBranchSettings });
  return {
    settings: query.data ?? null,
    loading: query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export function useSaveBranchSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BranchSettingsUpdateRequest) => updateBranchSettings(body),
    onSuccess: (settings) => {
      queryClient.setQueryData(printerKeys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: printConfigKey });
    },
  });
}
