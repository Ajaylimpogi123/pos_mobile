/**
 * The error log (Hardening & Pilot §B/§E), `system.manage`: the groups with
 * their filters and `meta.summary`, a group's detail (latest 50 events), and
 * resolve / reopen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import { getErrorGroup, listErrorGroups, reopenErrorGroup, resolveErrorGroup } from '@/services/errorLog';
import type { ErrorGroupStatus, ErrorLevel, ErrorLogListResponse, ErrorLogSummary, ErrorSource } from '@/services/types';

export type ErrorLogFilters = {
  status: ErrorGroupStatus;
  source: ErrorSource | null;
  level: ErrorLevel | null;
  search: string;
  /** `YYYY-MM-DD` or ''. */
  from: string;
  to: string;
};

export const errorLogKeys = {
  all: ['error-log'] as const,
  list: (filters: ErrorLogFilters) => ['error-log', 'list', filters] as const,
  detail: (id: number) => ['error-log', 'detail', id] as const,
};

export function useErrorLogList(filters: ErrorLogFilters) {
  const list = useCursorList(errorLogKeys.list(filters), (cursor) =>
    listErrorGroups({
      cursor,
      per_page: 25,
      status: filters.status,
      source: filters.source ?? undefined,
      level: filters.level ?? undefined,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
  );
  // The list endpoint's first page carries `meta.summary`.
  const summary: ErrorLogSummary | null = (list.firstPage as ErrorLogListResponse | null)?.meta.summary ?? null;
  return { ...list, summary };
}

export function useErrorGroup(id: number | null) {
  const query = useQuery({ queryKey: errorLogKeys.detail(id ?? 0), queryFn: () => getErrorGroup(id as number), enabled: id !== null });
  return {
    group: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** Resolve or reopen a group; the list and the detail are refreshed. */
export function useErrorGroupStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'resolve' | 'reopen' }) => (action === 'resolve' ? resolveErrorGroup(id) : reopenErrorGroup(id)),
    onSuccess: () => void client.invalidateQueries({ queryKey: errorLogKeys.all }),
  });
}
