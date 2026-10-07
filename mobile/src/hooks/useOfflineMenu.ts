import { useCallback, useEffect, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import {
  readCatalogueSummary,
  readMenuCategories,
  readMenuProducts,
  type CatalogueSummary,
  type MenuCategory,
  type MenuProduct,
} from '@/db/menuQueries';
import { useSyncStore } from '@/stores/sync';

export type OfflineMenuFilter = {
  /** `null`: all visible categories. */
  categoryId: number | null;
  /** Search text (trimmed here); `''` = no search. */
  search: string;
};

export type OfflineMenu = {
  /** Visible categories in menu order, with available-product counts. */
  categories: MenuCategory[];
  /** Visible products (unavailable ones included) matching the filter, in menu order. */
  products: MenuProduct[];
  /** Whether any catalogue row is stored on the device. `false` → "Menu not synced yet". */
  hasData: boolean;
  /** `meta.server_time` of the last completed sync, from SQLite. */
  serverTime: string | null;
  /** First read in progress (nothing to show yet). */
  loading: boolean;
  /** Reading the local database failed. */
  error: string | null;
  /** Re-reads SQLite. */
  reload: () => void;
};

export const MENU_READ_ERROR_MESSAGE = "The menu stored on this device couldn't be read.";

type CategoryState = { summary: CatalogueSummary; categories: MenuCategory[] };

/**
 * The Sell screen's menu, read **only** from on-device SQLite with the
 * contract's visibility rules (see `@/db/menuQueries`). Reads re-run after
 * every committed sync write (`catalogueVersion`) and whenever the filter
 * changes; the previous results stay on screen meanwhile, so a sync or a new
 * search never flashes a spinner.
 */
export function useOfflineMenu(filter: OfflineMenuFilter): OfflineMenu {
  const version = useSyncStore((state) => state.catalogueVersion);
  const [reloadKey, setReloadKey] = useState(0);
  const [categoryState, setCategoryState] = useState<CategoryState | null>(null);
  const [products, setProducts] = useState<MenuProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = filter.search.trim();
  const { categoryId } = filter;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await prepareDatabase())) throw new Error(MENU_READ_ERROR_MESSAGE);
        const [summary, categories] = await Promise.all([readCatalogueSummary(), readMenuCategories()]);
        if (!cancelled) setCategoryState({ summary, categories });
      } catch {
        if (!cancelled) setError(useSyncStore.getState().databaseError ?? MENU_READ_ERROR_MESSAGE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await prepareDatabase())) throw new Error(MENU_READ_ERROR_MESSAGE);
        const rows = await readMenuProducts({ categoryId, search });
        if (!cancelled) {
          setProducts(rows);
          setError(null);
        }
      } catch {
        if (!cancelled) setError(useSyncStore.getState().databaseError ?? MENU_READ_ERROR_MESSAGE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, reloadKey, categoryId, search]);

  const reload = useCallback(() => {
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  return {
    categories: categoryState?.categories ?? [],
    products: products ?? [],
    hasData: categoryState?.summary.hasData ?? false,
    serverTime: categoryState?.summary.serverTime ?? null,
    loading: error === null && (categoryState === null || products === null),
    error,
    reload,
  };
}
