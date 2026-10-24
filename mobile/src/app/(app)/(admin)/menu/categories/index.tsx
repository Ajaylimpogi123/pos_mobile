import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CatalogImage } from '@/components/menu/CatalogImage';
import { CategoryCard, itemCountLabel } from '@/components/menu/CategoryCard';
import { MenuHeader } from '@/components/menu/MenuHeader';
import { CardGrid, type GridTable } from '@/components/shared/CardGrid';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { Screen } from '@/components/ui/Screen';
import { editCategoryRoute, ROUTES } from '@/constants/routes';
import { sizes, spacing } from '@/constants/theme';
import { useAdminCategoryList } from '@/hooks/menu/useAdminCategories';
import type { Category } from '@/services/types';

function openNewCategory() {
  router.push(ROUTES.newCategory);
}

function openCategory(category: Category) {
  router.push(editCategoryRoute(category.id));
}

function categoryKey(category: Category): string {
  return String(category.id);
}

function rowTestID(category: Category): string {
  return `category-card-${category.id}`;
}

/** The table (tablets in landscape): photo and name (and description), item count, sort order, status. Test IDs match the card's. */
const CATEGORY_TABLE: GridTable<Category> = {
  columns: [
    {
      key: 'name',
      header: 'Category',
      flex: 2.2,
      render: (category) => (
        <View style={styles.nameCell}>
          <CatalogImage
            uri={category.image_url}
            placeholderIcon="grid-outline"
            accessibilityLabel={category.name}
            recyclingKey={String(category.id)}
            dimmed={!category.is_active}
            style={styles.thumb}
          />
          <View style={styles.nameText}>
            <CellText variant="strong">{category.name}</CellText>
            {category.description ? <CellText variant="muted">{category.description}</CellText> : null}
          </View>
        </View>
      ),
    },
    {
      key: 'count',
      header: 'Items',
      flex: 0.8,
      render: (category) => <CellText testID={`${rowTestID(category)}-count`}>{itemCountLabel(category.products_count)}</CellText>,
    },
    { key: 'sort', header: 'Sort', flex: 0.6, render: (category) => <CellText variant="muted">Sort {category.sort_order}</CellText> },
    {
      key: 'status',
      header: 'Status',
      flex: 0.8,
      render: (category) => (
        <Chip
          label={category.is_active ? 'Active' : 'Inactive'}
          variant={category.is_active ? 'completed' : 'neutral'}
          testID={`${rowTestID(category)}-status`}
        />
      ),
    },
  ],
  onRowPress: openCategory,
  rowAccessibilityLabel: (category) =>
    `${category.name}, ${itemCountLabel(category.products_count)}, ${category.is_active ? 'active' : 'inactive'}`,
  rowAccessibilityHint: 'Opens the category to edit it',
  rowTestID,
};

/**
 * Menu admin: categories (active and inactive), ordered by the server.
 * Same layout and list states as the products screen: the band, then the table
 * on tablets in landscape and the cards in portrait (MASTER §6); "Showing n",
 * infinite scroll, pull-to-refresh, loading / empty / error-with-retry.
 */
export default function AdminCategoriesScreen() {
  const list = useAdminCategoryList();

  return (
    <Screen edges={[]} testID="admin-categories-screen">
      <MenuHeader section="categories" newLabel="New category" onNew={openNewCategory} />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <CardGrid
          items={list.categories}
          keyOf={categoryKey}
          renderItem={(category) => <CategoryCard category={category} onPress={openCategory} />}
          {...list.grid}
          empty={{
            title: 'No categories yet',
            message: 'Categories group your menu, e.g. Breakfast, Meals and Drinks. Add one to start.',
            icon: 'grid-outline',
            actionLabel: 'New category',
            onAction: openNewCategory,
          }}
          table={CATEGORY_TABLE}
          testID="categories-grid"
        />
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
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: '100%',
  },
  thumb: {
    width: sizes.thumbnail,
    height: sizes.thumbnail,
  },
  nameText: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
});
