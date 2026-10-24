import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IngredientCard } from '@/components/ingredients/IngredientCard';
import { CardGrid, type GridEmptyProps, type GridTable } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { ingredientRoute, ROUTES } from '@/constants/routes';
import { spacing } from '@/constants/theme';
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

function rowTestID(ingredient: Ingredient): string {
  return `ingredient-card-${ingredient.id}`;
}

/** The table (tablets in landscape): name (and Inactive), base unit and its own units. */
function useIngredientTable(): GridTable<Ingredient> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'name',
          header: 'Ingredient',
          flex: 1.6,
          render: (ingredient) => (
            <View style={styles.nameCell}>
              <CellText variant="strong">{ingredient.name}</CellText>
              {ingredient.is_active ? null : <Chip label="Inactive" testID={`${rowTestID(ingredient)}-inactive`} />}
            </View>
          ),
        },
        { key: 'base', header: 'Base unit', flex: 0.8, render: (ingredient) => <CellText>{ingredient.base_unit}</CellText> },
        {
          key: 'units',
          header: 'Own units',
          flex: 1.4,
          render: (ingredient) => (
            <CellText variant={ingredient.units.length === 0 ? 'muted' : 'default'}>
              {ingredient.units.length === 0 ? 'No own units' : ingredient.units.map((unit) => unit.name).join(', ')}
            </CellText>
          ),
        },
      ],
      onRowPress: openIngredient,
      rowAccessibilityLabel: (ingredient) => `${ingredient.name}, base unit ${ingredient.base_unit}${ingredient.is_active ? '' : ', inactive'}`,
      rowAccessibilityHint: 'Opens the ingredient',
      rowTestID,
    }),
    [],
  );
}

/**
 * Ingredients (Catalogue, `product.manage`): on the band (with the Add pill),
 * the search and the `All · Active · Inactive` filter in a white card, then the
 * table in landscape and the cards in portrait (MASTER §6); tapping one edits it. Every list state; offline: `Ingredients need a connection.`
 */
export function IngredientListScreen() {
  const screen = useIngredientListScreen();
  const table = useIngredientTable();

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
      <ListHeader band title="Ingredients" newLabel="New ingredient" onNew={screen.online ? openNew : undefined} testIDPrefix="ingredients" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="ingredients-toolbar">
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
        </ListToolbar>
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(ingredient) => (
              <IngredientCard ingredient={ingredient} variant="admin" onPress={openIngredient} />
            )}
            {...screen.list.grid}
            empty={empty}
            table={table}
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
  nameCell: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
