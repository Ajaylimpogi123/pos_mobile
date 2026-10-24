import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuHeader } from '@/components/menu/MenuHeader';
import { CatalogImage } from '@/components/menu/CatalogImage';
import { ProductCard } from '@/components/menu/ProductCard';
import { ProductFilters } from '@/components/menu/ProductFilters';
import { CardGrid, type GridTable } from '@/components/shared/CardGrid';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { Banner } from '@/components/ui/Banner';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { Screen } from '@/components/ui/Screen';
import { editProductRoute, ROUTES } from '@/constants/routes';
import { colors, opacity, radius, sizes, spacing } from '@/constants/theme';
import { useProductListScreen } from '@/hooks/menu/useProductListScreen';
import type { AdminProduct } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

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
 * - MASTER §6: the band (with the Add pill), the filters in a white card, then
 *   the table on tablets in landscape and the cards in portrait and on phones;
 *   "Showing n" and Load more, infinite scroll, pull-to-refresh, loading /
 *   empty / error-with-retry (403 → "No access").
 * - Each card's Switch flips availability optimistically (rolled back on error).
 */
/**
 * The table (tablets in landscape): the product (photo, name, category · SKU;
 * tapping it opens the edit form), price, cost, stock, status and the quick
 * availability switch. Test IDs match the card's.
 */
function useProductTable(pendingIds: ReadonlySet<number>, onToggle: (product: AdminProduct, value: boolean) => void): GridTable<AdminProduct> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'product',
          header: 'Product',
          flex: 2.2,
          render: (product) => {
            const testID = `product-card-${product.id}`;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${product.name}, ${formatPeso(product.price_cents)}${product.is_available ? '' : ', unavailable'}`}
                accessibilityHint="Opens the product to edit it"
                onPress={() => openProduct(product)}
                style={({ pressed }) => [styles.productCell, pressed && styles.pressed]}
                testID={`${testID}-open`}
              >
                <CatalogImage
                  uri={product.image_url}
                  placeholderIcon="fast-food-outline"
                  accessibilityLabel={product.name}
                  recyclingKey={String(product.id)}
                  dimmed={!product.is_available}
                  style={styles.thumb}
                  testID={`${testID}-thumb`}
                />
                <View style={styles.productText}>
                  <CellText variant="strong" numberOfLines={2}>
                    {product.name}
                  </CellText>
                  <CellText variant="muted">
                    {product.category.name}
                    {product.sku ? ` · ${product.sku}` : ''}
                  </CellText>
                </View>
              </Pressable>
            );
          },
        },
        {
          key: 'price',
          header: 'Price',
          align: 'right',
          render: (product) => (
            <CellText variant="strong" align="right" style={styles.price} testID={`product-card-${product.id}-price`}>
              {formatPeso(product.price_cents)}
            </CellText>
          ),
        },
        {
          key: 'cost',
          header: 'Cost',
          align: 'right',
          render: (product) => (
            <CellText variant="muted" align="right" testID={`product-card-${product.id}-cost`}>
              Cost {formatPeso(product.cost_cents)}
            </CellText>
          ),
        },
        {
          key: 'stock',
          header: 'Stock',
          render: (product) =>
            product.track_stock && product.stock_qty !== null ? (
              <Chip
                label={`${formatCount(product.stock_qty)} in stock`}
                variant={product.stock_qty <= 0 ? 'cancelled' : 'neutral'}
                testID={`product-card-${product.id}-stock`}
              />
            ) : (
              <CellText variant="muted">—</CellText>
            ),
        },
        {
          key: 'available',
          header: 'Available',
          render: (product) => (
            <View style={styles.availability}>
              {product.is_available ? null : <Chip label="Unavailable" variant="cancelled" testID={`product-card-${product.id}-unavailable`} />}
              <Switch
                value={product.is_available}
                onValueChange={(value) => onToggle(product, value)}
                disabled={pendingIds.has(product.id)}
                accessibilityLabel={`${product.name} available`}
                trackColor={{ false: colors.borderStrong, true: colors.primaryBright }}
                thumbColor={colors.surface}
                ios_backgroundColor={colors.borderStrong}
                testID={`product-card-${product.id}-switch`}
              />
            </View>
          ),
        },
      ],
      // The product cell and the switch are their own controls, so the row doesn't group them.
      rowAccessible: false,
      rowTestID: (product) => `product-card-${product.id}`,
    }),
    [pendingIds, onToggle],
  );
}

export default function AdminProductsScreen() {
  const screen = useProductListScreen();
  const { list } = screen;
  // Stable, so the memoized cards only re-render when their own product changes.
  const toggleAvailable = useLatestCallback(screen.toggleAvailable);
  const table = useProductTable(screen.pendingIds, toggleAvailable);

  return (
    <Screen edges={[]} testID="admin-products-screen">
      <MenuHeader section="products" newLabel="New product" onNew={openNewProduct} />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="products-toolbar">
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
        </ListToolbar>
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
          table={table}
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
  productCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    maxWidth: '100%',
  },
  pressed: {
    opacity: opacity.pressed,
  },
  thumb: {
    width: sizes.thumbnail,
    height: sizes.thumbnail,
  },
  productText: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  price: {
    color: colors.green,
  },
  availability: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
