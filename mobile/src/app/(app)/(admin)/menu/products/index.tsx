import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuHeader } from '@/components/menu/MenuHeader';
import { ProductCard } from '@/components/menu/ProductCard';
import { ProductFilters } from '@/components/menu/ProductFilters';
import { CardGrid } from '@/components/shared/CardGrid';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { Banner } from '@/components/ui/Banner';
import { Screen } from '@/components/ui/Screen';
import { editProductRoute, ROUTES } from '@/constants/routes';
import { useProductListScreen } from '@/hooks/menu/useProductListScreen';
import type { AdminProduct } from '@/services/types';

function openNewProduct() {
  router.push(ROUTES.newProduct);
}

function openProduct(product: AdminProduct) {
  router.push(editProductRoute(product.id));
}

function productKey(product: AdminProduct): string {
  return String(product.id);
}

/**
 * Menu admin: products.
 * - Header: back, "Menu", "+" (new product), Products / Categories tabs.
 * - Filters (outside the list, so they survive loading/empty states and
 *   rotation): search (300 ms debounce), availability, category chips.
 * - Card grid: 1 column on phone portrait, 2 on phone landscape / tablet
 *   portrait, 3 on tablet landscape; infinite scroll, pull-to-refresh,
 *   loading / empty / error-with-retry (403 → "No access").
 * - Each card's Switch flips availability optimistically (rolled back on error).
 */
export default function AdminProductsScreen() {
  const screen = useProductListScreen();
  const { list } = screen;
  // Stable, so the memoized cards only re-render when their own product changes.
  const toggleAvailable = useLatestCallback(screen.toggleAvailable);

  return (
    <Screen edges={[]} testID="admin-products-screen">
      <MenuHeader section="products" newLabel="New product" onNew={openNewProduct} />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ProductFilters
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          categories={screen.categories}
          categoryId={screen.categoryId}
          onCategoryChange={screen.setCategoryId}
          availability={screen.availability}
          onAvailabilityChange={screen.setAvailability}
        />
        <CardGrid
          items={screen.list.products}
          keyOf={productKey}
          renderItem={(product) => (
            <ProductCard
              product={product}
              toggling={screen.pendingIds.has(product.id)}
              onToggleAvailable={toggleAvailable}
              onPress={openProduct}
            />
          )}
          {...list.grid}
          header={
            screen.toggleError ? <Banner message={screen.toggleError} testID="toggle-error-banner" /> : null
          }
          empty={
            screen.filtersActive
              ? {
                  title: 'No matching products',
                  message: 'Try another search, or clear the filters.',
                  icon: 'search-outline',
                  actionLabel: 'Clear filters',
                  onAction: screen.clearFilters,
                }
              : {
                  title: 'No products yet',
                  message: 'Add your first menu item. It will show here and on the POS menu.',
                  icon: 'fast-food-outline',
                  actionLabel: 'New product',
                  onAction: openNewProduct,
                }
          }
          testID="products-grid"
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
