import { useMemo } from 'react';

import { useIngredientOptions } from '@/hooks/ingredients/useIngredients';
import type { DecimalValue, Ingredient, RecipeComponentType } from '@/services/types';

/**
 * One choice of the recipe component picker. The picker offers active
 * ingredients only (user request, 2026-09-30); `type` stays a union because
 * saved recipes may still carry own-stock product components, which keep
 * displaying and costing as before.
 */
export type RecipeComponentOption = {
  key: string;
  type: RecipeComponentType;
  id: number;
  name: string;
  /** The ingredient (its base unit and units); `null` for a product (`pc` only). */
  ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null;
  /** Centavos per base unit, for the live cost preview: the ingredient's `avg_cost`, the product's `cost_cents`. */
  unitCost: DecimalValue;
  imageUrl: string | null;
};

/** The recipe component picker's options for a (debounced) search: active ingredients only. */
export function useRecipeComponentPicker(search: string, enabled: boolean) {
  const ingredients = useIngredientOptions(search, enabled);

  const options = useMemo<RecipeComponentOption[]>(
    () =>
      ingredients.items.map((ingredient) => ({
        key: `ingredient-${ingredient.id}`,
        type: 'ingredient' as const,
        id: ingredient.id,
        name: ingredient.name,
        ingredient,
        unitCost: ingredient.avg_cost,
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
