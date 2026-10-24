import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useCursorList } from '@/hooks/useCursorList';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { getErrorMessage } from '@/services/api';
import { getErrorGroup, listErrorGroups, reopenErrorGroup, resolveErrorGroup } from '@/services/clientErrors';
import type { ErrorGroup, ErrorGroupDetail, ErrorGroupStatus, ErrorLevel, ErrorLogSummary, ErrorSource } from '@/services/types';

export const ERROR_SEARCH_DEBOUNCE_MS = 300;

export type SourceFilter = 'all' | ErrorSource;
export type LevelFilter = 'all' | ErrorLevel;
/** `from` on `last_seen_at`: none, today, the last 7 or 30 days (device-local dates). */
export type RangeFilter = 'any' | 'today' | '7d' | '30d';

export const errorLogKeys = {
  all: ['error-log'] as const,
  lists: () => [...errorLogKeys.all, 'list'] as const,
  list: (filters: Record<string, string>) => [...errorLogKeys.lists(), filters] as const,
  detail: (id: number) => [...errorLogKeys.all, 'detail', id] as const,
};

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The `from` date of a range (`YYYY-MM-DD`), or `undefined` for any time. */
export function rangeFrom(range: RangeFilter, now: number = Date.now()): string | undefined {
  if (range === 'any') return undefined;
  const days = range === 'today' ? 0 : range === '7d' ? 6 : 29;
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return ymd(date);
}

/** The Error log list (`system.manage`): status (default open), source, level, time range, search; `meta.summary`. */
export function useErrorLogScreen() {
  const [status, setStatus] = useState<ErrorGroupStatus>('open');
  const [source, setSource] = useState<SourceFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [range, setRange] = useState<RangeFilter>('any');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), ERROR_SEARCH_DEBOUNCE_MS);
  const from = rangeFrom(range);

  const list = useCursorList<ErrorGroup>({
    queryKey: errorLogKeys.list({ status, source, level, range, search: debounced }),
    fetchPage: (cursor) =>
      listErrorGroups({
        cursor,
        status,
        source: source === 'all' ? undefined : source,
        level: level === 'all' ? undefined : level,
        search: debounced || undefined,
        from,
      }),
    keepPrevious: true,
  });

  const firstMeta = list.data?.pages[0]?.meta as { summary?: ErrorLogSummary } | undefined;
  const summary = firstMeta?.summary ?? null;

  return {
    status,
    setStatus,
    source,
    setSource,
    level,
    setLevel,
    range,
    setRange,
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    filtersActive: status !== 'open' || source !== 'all' || level !== 'all' || range !== 'any' || debounced !== '',
    clearFilters: () => {
      setStatus('open');
      setSource('all');
      setLevel('all');
      setRange('any');
      setSearch('');
    },
    summary,
    list,
  };
}

/** One group with its latest 50 events, plus resolve / reopen. */
export function useErrorGroup(id: number | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: errorLogKeys.detail(id ?? -1),
    queryFn: () => getErrorGroup(id as number),
    enabled: id !== null,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (next: 'resolve' | 'reopen') => (next === 'resolve' ? resolveErrorGroup(id as number) : reopenErrorGroup(id as number)),
    onMutate: () => setActionError(null),
    onSuccess: (group) => {
      client.setQueryData<ErrorGroupDetail>(errorLogKeys.detail(group.id), (current) => (current ? { ...current, ...group } : current));
      void client.invalidateQueries({ queryKey: errorLogKeys.lists() });
    },
    onError: (error) => setActionError(getErrorMessage(error)),
  });

  return {
    query,
    actionError,
    toggling: toggle.isPending,
    resolve: () => toggle.mutate('resolve'),
    reopen: () => toggle.mutate('reopen'),
  };
}
