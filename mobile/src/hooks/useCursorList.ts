import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { CursorPage } from '@/services/types';
import { uniqueBy } from '@/utils/collections';

type UseCursorListOptions<T> = {
  queryKey: QueryKey;
  /** Fetches one page; `cursor` is `undefined` for the first page. */
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>;
  /** Keep the previous results on screen while new filters load (default `false`). */
  keepPrevious?: boolean;
  /** Follow `next_cursor` automatically until the last page (e.g. filter chips, pickers). */
  fetchAll?: boolean;
  enabled?: boolean;
};

/**
 * A cursor-paginated list (Global Conventions: `data` + `meta.next_cursor`)
 * as a TanStack infinite query. Returns the query, the flattened items
 * (de-duplicated by `keyOf`), and `grid`: the props `CardGrid` needs for its
 * loading / error / empty / pull-to-refresh / load-more states.
 */
export function useKeyedCursorList<T>({
  queryKey,
  fetchPage,
  keepPrevious = false,
  fetchAll = false,
  enabled = true,
  keyOf,
}: UseCursorListOptions<T> & { keyOf: (item: T) => string | number }) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.next_cursor,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    enabled,
  });

  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (fetchAll && hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [fetchAll, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  // Pass a stable (module-level) `keyOf`, so only new pages change `items`.
  const items = useMemo(() => uniqueBy(query.data?.pages.flatMap((page) => page.data) ?? [], keyOf), [query.data, keyOf]);

  const grid = {
    loading: query.isPending,
    error: query.isError && !query.isFetchNextPageError ? query.error : null,
    onRetry: () => void query.refetch(),
    onRefresh: () => query.refetch(),
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    nextPageError: query.isFetchNextPageError ? query.error : null,
    fetchNextPage: () => void query.fetchNextPage(),
    updating: query.isFetching && query.isPlaceholderData,
  };

  return { ...query, items, grid };
}

function idOf(item: { id: number }): number {
  return item.id;
}

/** `useKeyedCursorList` for records with an integer `id` (most lists). */
export function useCursorList<T extends { id: number }>(options: UseCursorListOptions<T>) {
  return useKeyedCursorList<T>({ ...options, keyOf: idOf });
}

export type CursorListGridState = ReturnType<typeof useCursorList>['grid'];
