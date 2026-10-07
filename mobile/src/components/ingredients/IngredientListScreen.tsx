import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IngredientCard } from '@/components/ingredients/IngredientCard';
import { CardGrid, type GridEmptyProps } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { ingredientRoute, ROUTES } from '@/constants/routes';
import { INGREDIENTS_OFFLINE_MESSAGE, useIngredientListScreen, type IngredientSegment } from '@/hooks/ingredients/useIngredients';
import type { Ingredient } from '@/services/types';

const SEGMENTS: readonly SegmentOption<IngredientSegment>[] = [
  { value: 'all', label: 'All', testID: 'ingredients-segment-all' },
  { value: 'active', label: 'Active', testID: 'ingredients-segment-active' },
  { value: 'inactive', label: 'Inactive', testID: 'ingredients-segment-inactive' },
];

function keyOf(ingredient: Ingredient): string {
  return String(ingredient.id);
}

function openIngredient(ingredient: Ingredient) {
  router.push(ingredientRoute(ingredient.id));
}

function openNew() {
  router.push(ROUTES.newIngredient);
}

/**
 * Ingredients (Catalogue, `product.manage`): the card grid with a pill search
 * and an `All · Active · Inactive` filter; "+" creates one; tapping a card
 * edits it. Every list state; offline: `Ingredients need a connection.`
 */
export function IngredientListScreen() {
  const screen = useIngredientListScreen();

  const empty: GridEmptyProps = screen.filtersActive
    ? {
        title: 'No matching ingredients',
        message: 'Try another name, or show every ingredient.',
        icon: 'search-outline',
        actionLabel: 'Clear filters',
        onAction: screen.clearFilters,
      }
    : {
        title: 'No ingredients yet',
        message: 'Add flour, milk, eggs… with the unit you stock them in.',
        icon: 'nutrition-outline',
        actionLabel: 'New ingredient',
        onAction: openNew,
      };

  return (
    <Screen edges={[]} testID="ingredient-list-screen">
      <ListHeader title="Ingredients" newLabel="New ingredient" onNew={screen.online ? openNew : undefined} testIDPrefix="ingredients" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListFilters<IngredientSegment>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Ingredient name"
          searchTestID="ingredient-search"
          segment={{
            options: SEGMENTS,
            value: screen.segment,
            onChange: screen.setSegment,
            accessibilityLabel: 'Active filter',
            testID: 'ingredients-segment',
          }}
        />
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(ingredient) => (
              <IngredientCard ingredient={ingredient} variant="admin" onPress={openIngredient} />
            )}
            {...screen.list.grid}
            empty={empty}
            testID="ingredients-grid"
          />
        ) : (
          <EmptyState
            title={INGREDIENTS_OFFLINE_MESSAGE}
            message="Ingredients load from the server. Connect this tablet and try again."
            icon="cloud-offline-outline"
            testID="ingredients-offline"
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});
