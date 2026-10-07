import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryCard } from '@/components/menu/CategoryCard';
import { MenuHeader } from '@/components/menu/MenuHeader';
import { CardGrid } from '@/components/shared/CardGrid';
import { Screen } from '@/components/ui/Screen';
import { editCategoryRoute, ROUTES } from '@/constants/routes';
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

/**
 * Menu admin: categories (active and inactive), ordered by the server.
 * Same responsive grid and list states as the products screen: 1 / 2 / 3
 * columns, infinite scroll, pull-to-refresh, loading / empty / error-with-retry.
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
});
