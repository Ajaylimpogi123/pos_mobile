import { useEffect, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import { readRoutableCategories, type RoutableCategory } from '@/db/menuQueries';
import { useSyncStore } from '@/stores/sync';

export type RoutableCategories = {
  categories: RoutableCategory[];
  loading: boolean;
  error: string | null;
};

export const CATEGORIES_READ_ERROR = "The categories stored on this tablet couldn't be read. Sync the menu, then try again.";

/**
 * Every category on this tablet (the on-device catalogue, active and
 * inactive), for the printer form's category picker. Re-read after every
 * catalogue sync write.
 */
export function useRoutableCategories(): RoutableCategories {
  const version = useSyncStore((state) => state.catalogueVersion);
  const [state, setState] = useState<RoutableCategories>({ categories: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await prepareDatabase())) throw new Error('database');
        const categories = await readRoutableCategories();
        if (!cancelled) setState({ categories, loading: false, error: null });
      } catch {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: CATEGORIES_READ_ERROR }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return state;
}
