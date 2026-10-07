import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { ingredientKeys, ingredientStockKeys } from '@/hooks/purchasing/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsOnline } from '@/hooks/useIsOnline';
import { isApiError } from '@/services/api';
import {
  createIngredient,
  deleteIngredient,
  deleteIngredientImage,
  getIngredient,
  listIngredients,
  updateIngredient,
  uploadIngredientImage,
} from '@/services/ingredients';
import type { BaseUnit, Ingredient, IngredientUpdateRequest, UploadFile } from '@/services/types';

/** Ingredients per page. */
export const INGREDIENT_PAGE_SIZE = 25;

/** The list's active filter. */
export type IngredientSegment = 'all' | 'active' | 'inactive';

/** Contract wording while the device has no connection (the ingredient screens need one). */
export const INGREDIENTS_OFFLINE_MESSAGE = 'Ingredients need a connection.';

/**
 * The ingredient admin list (`/ingredients`, `product.manage`): a pill search
 * (300 ms debounce), an `All · Active · Inactive` filter, and the cursor list.
 */
export function useIngredientListScreen() {
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<IngredientSegment>('all');
  const online = useIsOnline();
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const list = useCursorList<Ingredient>({
    queryKey: ingredientKeys.list({ search: debounced, segment }),
    fetchPage: (cursor) =>
      listIngredients({
        per_page: INGREDIENT_PAGE_SIZE,
        cursor,
        search: debounced === '' ? undefined : debounced,
        is_active: segment === 'all' ? undefined : segment === 'active',
      }),
    keepPrevious: true,
    enabled: online,
  });

  return {
    online,
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    segment,
    setSegment,
    filtersActive: debounced !== '' || segment !== 'all',
    clearFilters: () => {
      setSearch('');
      setSegment('all');
    },
    list,
  };
}

/** GET /api/v1/admin/ingredients/{id}. */
export function useIngredient(id: number | null) {
  return useQuery({
    queryKey: ingredientKeys.detail(id ?? -1),
    queryFn: () => getIngredient(id as number),
    enabled: id !== null,
  });
}

/**
 * Active ingredients matching `search` (the PR item picker; readable with any
 * purchase permission).
 */
export function useIngredientOptions(search: string, enabled = true) {
  return useCursorList<Ingredient>({
    queryKey: ingredientKeys.list({ search, segment: 'active', picker: true }),
    fetchPage: (cursor) =>
      listIngredients({ per_page: INGREDIENT_PAGE_SIZE, cursor, search: search === '' ? undefined : search, is_active: true }),
    keepPrevious: true,
    enabled,
  });
}

/** Everything that shows an ingredient: its admin record, its stock, the lists, and the dashboard's alerts. */
export function useAfterIngredientWrite() {
  const client = useQueryClient();
  return (ingredient: Ingredient | null) => {
    if (ingredient) client.setQueryData(ingredientKeys.detail(ingredient.id), ingredient);
    void client.invalidateQueries({ queryKey: ingredientKeys.lists() });
    void client.invalidateQueries({ queryKey: ingredientStockKeys.all });
    void client.invalidateQueries({ queryKey: dashboardKeys.dashboard });
  };
}

/**
 * Ingredient mutations (the shape `useCatalogForm` drives). `onBaseUnitConflict`
 * runs when an update that changed `base_unit` gets the 409 `The base unit
 * can't change once the ingredient is in use.`
 */
export function useIngredientMutations(onBaseUnitConflict?: (savedBaseUnit: BaseUnit | null) => void) {
  const client = useQueryClient();
  const afterWrite = useAfterIngredientWrite();

  const create = useMutation({ mutationFn: createIngredient, onSuccess: afterWrite });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: IngredientUpdateRequest }) => updateIngredient(id, body),
    onSuccess: afterWrite,
    onError: (error, { id, body }) => {
      if (isApiError(error) && error.status === 409 && body.base_unit !== undefined) {
        // The last saved copy (every load and write caches it) holds the base unit the server kept.
        onBaseUnitConflict?.(client.getQueryData<Ingredient>(ingredientKeys.detail(id))?.base_unit ?? null);
      }
    },
  });

  const uploadImage = useMutation({
    mutationFn: ({ id, file }: { id: number; file: UploadFile }) => uploadIngredientImage(id, file),
    onSuccess: afterWrite,
  });

  const removeImage = useMutation({
    mutationFn: (id: number) => deleteIngredientImage(id),
    onSuccess: afterWrite,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteIngredient(id),
    onSuccess: () => afterWrite(null),
  });

  return { create, update, uploadImage, removeImage, remove };
}
