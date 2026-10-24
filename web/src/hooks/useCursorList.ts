/**
 * A cursor-paginated list (Global Conventions → paginated list) as one
 * TanStack infinite query: `meta.next_cursor` drives "Load more".
 */
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getErrorMessage } from '@/services/api';
import type { CursorPage } from '@/services/types';

export type CursorList<T> = {
  items: T[];
  /** The first page as the server sent it (e.g. its `meta.summary`), or `null` before it loads. */
  firstPage: CursorPage<T> | null;
  /** First load. */
  loading: boolean;
  /** The first page failed. */
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  /** A "Load more" failed (the loaded rows stay). */
  loadMoreError: string | null;
  loadMore: () => void;
  retry: () => void;
  refreshing: boolean;
};

export function useCursorList<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
): CursorList<T> {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: options.enabled ?? true,
    // Polling (e.g. the Tables view): only while the browser tab is visible (TanStack's default).
    refetchInterval: options.refetchInterval ?? false,
  });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const firstPageFailed = query.isError && !query.data;

  return {
    items,
    firstPage: query.data?.pages[0] ?? null,
    loading: query.isPending && (options.enabled ?? true),
    error: firstPageFailed ? getErrorMessage(query.error) : null,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMoreError: query.isFetchNextPageError ? getErrorMessage(query.error) : null,
    loadMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
    refreshing: query.isRefetching,
  };
}
