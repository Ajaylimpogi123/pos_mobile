import { useCallback, useEffect, useRef } from 'react';
import type { FlatList, ViewToken } from 'react-native';

/** Stable across renders: FlatList does not allow changing it on the fly. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 } as const;

/** Delay before retrying `scrollToIndex` after FlatList reported the row wasn't measured yet. */
const SCROLL_RETRY_DELAY_MS = 50;

type ScrollToIndexFailedInfo = {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
};

/**
 * Keeps a card grid's scroll position when its column count changes (rotation).
 *
 * A FlatList can't change `numColumns` on the fly, so the grid gets a `key`
 * that changes with the column count and remounts. This hook records the first
 * visible *item* while scrolling (`onViewableItemsChanged`) and, after the
 * remount, scrolls back to the *row* that now holds that item. FlatList's
 * `scrollToIndex` addresses rows when `numColumns > 1`. Cards have variable
 * heights (no `getItemLayout`), so a failed jump first scrolls to an estimated
 * offset, then retries once the row is measured.
 */
export function useGridScrollRestore<T>(columns: number) {
  const listRef = useRef<FlatList<T>>(null);
  const anchorItemIndex = useRef(0);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
    let first: number | null = null;
    for (const token of viewableItems) {
      if (token.index != null && (first === null || token.index < first)) first = token.index;
    }
    if (first !== null) anchorItemIndex.current = first;
  }, []);

  useEffect(() => {
    // Row that holds the anchor item under the new column count.
    const row = Math.floor(anchorItemIndex.current / columns);
    if (row <= 0) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: row, animated: false, viewPosition: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [columns]);

  const onScrollToIndexFailed = useCallback((info: ScrollToIndexFailedInfo) => {
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 });
    }, SCROLL_RETRY_DELAY_MS);
  }, []);

  return {
    listRef,
    /** Pass as the FlatList `key`: changes only when the column count changes. */
    listKey: `grid-${columns}-col`,
    onViewableItemsChanged,
    viewabilityConfig: VIEWABILITY_CONFIG,
    onScrollToIndexFailed,
  };
}
