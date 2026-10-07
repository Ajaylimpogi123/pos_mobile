import { useMemo } from 'react';

import { useIngredientOptions } from '@/hooks/ingredients/useIngredients';
import type { Ingredient, PurchaseItemType } from '@/services/types';

/**
 * One choice of the PR item picker. The picker offers active ingredients only
 * (user request, 2026-09-30); `type` stays a union because existing PRs may
 * still carry own-stock product items, which keep displaying as before.
 */
export type PurchaseItemOption = {
  key: string;
  type: PurchaseItemType;
  id: number;
  name: string;
  /** The ingredient (its base unit and units); `null` for a product (`pc` only). */
  ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null;
  imageUrl: string | null;
};

/** The PR item picker's options for a (debounced) search: active ingredients only. */
export function usePurchaseItemPicker(search: string, enabled: boolean) {
  const ingredients = useIngredientOptions(search, enabled);

  const options = useMemo<PurchaseItemOption[]>(
    () =>
      ingredients.items.map((ingredient) => ({
        key: `ingredient-${ingredient.id}`,
        type: 'ingredient' as const,
        id: ingredient.id,
        name: ingredient.name,
        ingredient,
        imageUrl: ingredient.image_url,
      })),
    [ingredients.items],
  );

  return {
    options,
    loading: ingredients.isPending,
    error: ingredients.grid.error,
    retry: () => {
      void ingredients.refetch();
    },
    hasMore: Boolean(ingredients.hasNextPage),
    loadMore: () => {
      if (ingredients.hasNextPage && !ingredients.isFetchingNextPage) ingredients.grid.fetchNextPage();
    },
    loadingMore: ingredients.isFetchingNextPage,
  };
}
