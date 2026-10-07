import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, useWindowDimensions, View, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProductTile, TILE_IMAGE_HEIGHT, tileMetrics } from '@/components/sell/ProductTile';
import { EmptyState } from '@/components/ui/EmptyState';
import type { IconName } from '@/components/ui/Icon';
import { colors, layout, spacing } from '@/constants/theme';
import type { MenuProduct } from '@/db/menuQueries';
import { useRecipeChecks, useStockBadges } from '@/hooks/sell/useStockBadges';
import { useGridScrollRestore } from '@/hooks/useGridScrollRestore';
import { useResponsive } from '@/hooks/useResponsive';
import { toGridSlots, type GridSlot } from '@/utils/grid';

export type TileGridEmpty = {
  title: string;
  message: string;
  icon: IconName;
  actionLabel?: string;
  onAction?: () => void;
};

type ProductTileGridProps = {
  products: readonly MenuProduct[];
  /** Tiles per row, from `sellLayoutFor` (the cart panel and the sidebar take their share of the width). */
  columns: number;
  /** Users with a cart: a tap on an available tile adds one. Keep it stable (the grid is memoised). */
  onPressTile?: (product: MenuProduct) => void;
  /** The grid reaches the screen's bottom edge (no cart bar below it): pad for the safe area. */
  padBottomInset?: boolean;
  /** Pull-to-refresh: runs a catalogue sync; resolves when it finishes. */
  onRefresh: () => Promise<unknown>;
  /** Shown when the filter matches nothing. */
  empty: TileGridEmpty;
  /** Phones and portrait: each tile shows how many are in the cart. */
  showCartQty?: boolean;
};

/** Gap between tiles, across and down (POS board: 12–14). */
const TILE_GAP = spacing.md;
/** Rows rendered beyond the visible ones, in screens (small: less memory, and fast enough with fixed heights). */
const WINDOW_SIZE = 7;
const ROWS_PER_BATCH = 4;

type Slot = GridSlot<MenuProduct>;

const keyOf = (product: MenuProduct) => String(product.id);
const keyExtractor = (slot: Slot) => slot.key;

/**
 * The Sell screen's product tiles, `columns` per row. Tuned for the hot path:
 * - memoised grid and tiles, stable `renderItem` / `keyExtractor`;
 * - every tile has the same fixed height (`tileMetrics`), so rows use
 *   `getItemLayout` (no measuring, exact jumps when the column count changes);
 * - a small render window sized from the screen height.
 * The FlatList is keyed by the column count and `useGridScrollRestore` keeps
 * the first visible tile on rotation. Pull-to-refresh runs a sync.
 */
export const ProductTileGrid = memo(function ProductTileGrid({
  products,
  columns,
  onPressTile,
  padBottomInset = true,
  onRefresh,
  empty,
  showCartQty = false,
}: ProductTileGridProps) {
  const { screenPaddingX, screenPaddingY, isPhone, height } = useResponsive();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { listRef, listKey, onViewableItemsChanged, viewabilityConfig, onScrollToIndexFailed } =
    useGridScrollRestore<Slot>(columns);
  const [refreshing, setRefreshing] = useState(false);
  // Inventory: Low / Out badges from the cached stock (refreshed with `stockVersion`).
  const stock = useStockBadges(products);
  // §J: `Check stock` on recipe products with a component out.
  const recipeChecks = useRecipeChecks(products);

  const metrics = useMemo(
    () => tileMetrics(isPhone ? TILE_IMAGE_HEIGHT.compact : TILE_IMAGE_HEIGHT.regular, fontScale),
    [isPhone, fontScale],
  );
  const rowLength = metrics.height + TILE_GAP;
  const paddingTop = spacing.xs;
  const initialRows = Math.ceil(height / rowLength) + 1;

  const slots = useMemo(() => toGridSlots(products, columns, keyOf), [products, columns]);
  const extraData = useMemo(() => ({ stock, recipeChecks }), [stock, recipeChecks]);

  const renderItem: ListRenderItem<Slot> = useCallback(
    ({ item: slot }) => (
      <View style={styles.cell} testID="sell-tile-cell">
        {slot.item ? (
          <ProductTile
            product={slot.item}
            metrics={metrics}
            onPress={onPressTile}
            stock={stock.get(slot.item.id)}
            recipeCheck={recipeChecks.has(slot.item.id)}
            showCartQty={showCartQty}
          />
        ) : null}
      </View>
    ),
    [metrics, onPressTile, stock, recipeChecks, showCartQty],
  );

  // Rows (not items): FlatList addresses rows when `numColumns > 1`. Each row carries its gap below it.
  const getItemLayout = useCallback(
    (_data: ArrayLike<Slot> | null | undefined, index: number) => ({
      length: rowLength,
      offset: paddingTop + index * rowLength,
      index,
    }),
    [rowLength, paddingTop],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      colors={[colors.primaryBright]}
      tintColor={colors.primaryBright}
    />
  );

  if (products.length === 0) {
    return <EmptyState {...empty} refreshControl={refreshControl} testID="sell-products-empty" />;
  }

  return (
    <FlatList
      key={listKey}
      ref={listRef}
      data={slots}
      numColumns={columns}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      initialNumToRender={initialRows}
      maxToRenderPerBatch={ROWS_PER_BATCH}
      windowSize={WINDOW_SIZE}
      columnWrapperStyle={styles.row}
      contentContainerStyle={{
        paddingHorizontal: screenPaddingX,
        paddingTop,
        paddingBottom: (padBottomInset ? insets.bottom : 0) + screenPaddingY + layout.tabBarHeight,
      }}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onScrollToIndexFailed={onScrollToIndexFailed}
      extraData={extraData}
      style={styles.fill}
      testID="sell-products"
    />
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    gap: TILE_GAP,
    paddingBottom: TILE_GAP,
  },
  cell: {
    flex: 1,
  },
});
