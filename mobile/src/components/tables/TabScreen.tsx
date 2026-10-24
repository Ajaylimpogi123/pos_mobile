import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CartBar } from '@/components/sell/CartBar';
import { CategoryRail } from '@/components/sell/CategoryRail';
import { LineEditorDialog } from '@/components/sell/LineEditorDialog';
import { ProductTileGrid, type TileGridEmpty } from '@/components/sell/ProductTileGrid';
import { ProductTileSkeleton } from '@/components/sell/ProductTileSkeleton';
import { useShell } from '@/components/shell/ShellContext';
import { CancelItemDialog, MoveDialog, TabStateDialogs } from '@/components/tables/TabDialogs';
import { TabPanel } from '@/components/tables/TabPanel';
import { guestsLabel, tableLabel, TABLES_OFFLINE_MESSAGE } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { LoadingState } from '@/components/ui/LoadingState';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES, tabRoute } from '@/constants/routes';
import { layout, spacing } from '@/constants/theme';
import type { MenuProduct } from '@/db/menuQueries';
import { useCart } from '@/hooks/sell/useCart';
import { useCartEditors } from '@/hooks/sell/useCartEditors';
import { useSellScreen } from '@/hooks/sell/useSellScreen';
import { useTab, type TabState } from '@/hooks/tables/useTab';
import { useTabItemCancel } from '@/hooks/tables/useTabItemCancel';
import { useTabMove } from '@/hooks/tables/useTabMove';
import { useSellModeStore } from '@/hooks/tables/useTablesView';
import { sellLayoutFor, useResponsive } from '@/hooks/useResponsive';
import { isApiError, getErrorMessage } from '@/services/api';
import type { Tab } from '@/services/types';
import { CartStoreProvider } from '@/stores/cart';
import { goBackOr } from '@/utils/navigation';

function backToTables() {
  useSellModeStore.getState().setMode('tables');
  goBackOr(ROUTES.sell);
}

/** The menu and the tab's panel, once the open tab is loaded. */
function OpenTab({ state, tab }: { state: TabState; tab: Tab }) {
  const screen = useSellScreen();
  const responsive = useResponsive();
  const { sidebarWidth } = useShell();
  const sellLayout = sellLayoutFor(responsive, { cart: true, sidebarWidth });
  const editors = useCartEditors({ lineDiscounts: false });
  const cart = useCart();
  const cancel = useTabItemCancel(tab, (message) => state.reloadWithConflict(message));
  const move = useTabMove(tab, (message) => state.reloadWithConflict(message));
  const { menu } = screen;

  // Tablet portrait and phones: the tab panel sits behind the bottom bar (its own actions don't fit under the menu).
  const barMode = sellLayout.cartBar || sellLayout.cartBelow;
  if (!barMode && editors.sheetOpen) editors.closeSheet();

  const addProductRef = useRef(editors.addProduct);
  useEffect(() => {
    addProductRef.current = editors.addProduct;
  });
  const addProduct = useCallback((product: MenuProduct) => addProductRef.current(product), []);

  const empty: TileGridEmpty = useMemo(
    () =>
      screen.filtersActive
        ? {
            title: 'No matching items',
            message: 'Try another name or SKU, or choose another category.',
            icon: 'search-outline',
            actionLabel: 'Show all items',
            onAction: () => {
              screen.setSearch('');
              screen.setCategoryId(null);
            },
          }
        : { title: 'No items on the menu yet', message: 'Items added in Menu show here after the next sync.', icon: 'fast-food-outline' },
    [screen],
  );

  const showFilters = menu.hasData && menu.error === null;
  let body;
  if (menu.error) body = <ErrorState title="Couldn't open the menu" message={menu.error} onRetry={menu.reload} testID="tab-menu-error" />;
  else if (menu.loading) body = <ProductTileSkeleton columns={sellLayout.tileColumns} message="Loading the menu…" testID="tab-menu-loading" />;
  else if (!menu.hasData) {
    body = (
      <EmptyState
        title="Menu not synced yet"
        message="Download the menu to this device first."
        icon="cloud-download-outline"
        actionLabel="Sync now"
        onAction={screen.syncNow}
        testID="tab-menu-empty"
      />
    );
  } else {
    body = (
      <ProductTileGrid
        products={menu.products}
        columns={sellLayout.tileColumns}
        onPressTile={addProduct}
        padBottomInset={!barMode}
        onRefresh={screen.refresh}
        empty={empty}
        showCartQty={barMode}
      />
    );
  }

  const panel = (variant: 'side' | 'sheet') => (
    <TabPanel variant={variant} state={state} tab={tab} editors={editors} cancel={cancel} move={move} />
  );

  return (
    <View style={[styles.fill, sellLayout.cartSide ? styles.row : styles.column]}>
      <View style={styles.fill}>
        <TopBar
          title={`${tableLabel(tab.table.name)} · ${guestsLabel(tab.guests)}`}
          left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back to tables" onPress={backToTables} testID="tab-back" />}
          testID="tab-header"
        >
          {showFilters ? (
            <View style={[styles.search, { paddingHorizontal: responsive.screenPaddingX }]}>
              <Input
                label="Search the menu"
                value={screen.search}
                onChangeText={screen.setSearch}
                variant="search"
                leftIcon="search-outline"
                placeholder="Name or SKU"
                returnKeyType="search"
                testID="tab-search"
              />
            </View>
          ) : null}
        </TopBar>
        <SafeAreaView edges={['left', 'right']} style={styles.body}>
          <View style={styles.fill}>
            {editors.notice ? (
              <View style={{ paddingHorizontal: responsive.screenPaddingX }}>
                <Banner variant="warning" message={editors.notice} testID="tab-notice" />
              </View>
            ) : null}
            {showFilters ? (
              <CategoryRail categories={menu.categories} selectedId={screen.categoryId} onChange={screen.setCategoryId} />
            ) : null}
            {body}
          </View>
        </SafeAreaView>
      </View>
      {sellLayout.cartSide ? panel('side') : null}
      {barMode ? (
        <CartBar
          itemCount={cart.itemCount + tab.items.reduce((sum, item) => sum + item.remaining_qty, 0)}
          totalCents={tab.remaining_cents + cart.pricing.total_cents}
          tableNo={tab.table.name}
          attention={cart.awaitingConfirmation || cart.hasServerMessages || !cart.isEmpty}
          onOpen={editors.openSheet}
        />
      ) : null}
      <BottomSheet visible={editors.sheetOpen && barMode} onClose={editors.closeSheet} closeLabel="Close the bill panel" testID="tab-sheet">
        {panel('sheet')}
      </BottomSheet>
      <LineEditorDialog editors={editors} />
      <ConfirmDialog
        visible={editors.clearOpen}
        title="Clear the new round?"
        message="The items not sent to the kitchen yet are removed. Items already sent stay on the bill."
        confirmLabel="Clear round"
        confirmVariant="danger"
        icon="trash-outline"
        onConfirm={editors.confirmClear}
        onCancel={editors.cancelClear}
        testID="tab-clear-dialog"
      />
      <CancelItemDialog cancel={cancel} />
      <MoveDialog move={move} tab={tab} />
    </View>
  );
}

/**
 * A dine-in tab (`/tabs/[ulid]`, `sale.create`; Dine-in Tables & Tabs §I):
 * the header `Table 5 · 3 guests`, the menu as on Sell, and the tab's panel
 * (new round, bill by round, actions). The round is its own cart
 * (`roundCartFor`), handed to the shared cart hooks through
 * `CartStoreProvider`, so the pay-now cart is never touched. Online only:
 * offline it says `Tables need a connection.`. A closed or merged tab shows
 * what happened, with the way back.
 */
export function TabScreen({ ulid }: { ulid: string }) {
  const state = useTab(ulid);
  const { tab } = state;

  let content;
  if (!state.online) {
    content = (
      <EmptyState
        title={TABLES_OFFLINE_MESSAGE}
        message="Open bills live on the server. Pay now still works offline."
        icon="cloud-offline-outline"
        actionLabel="Back to Sell"
        onAction={backToTables}
        testID="tab-offline"
      />
    );
  } else if (state.loading) {
    content = <LoadingState message="Opening the bill…" testID="tab-loading" />;
  } else if (!tab) {
    const missing = isApiError(state.error) && state.error.status === 404;
    content = (
      <ErrorState
        title={missing ? 'This bill was not found' : "Couldn't open the bill"}
        message={missing ? 'It may belong to another branch, or the link is wrong.' : getErrorMessage(state.error)}
        onRetry={state.refetch}
        testID="tab-error"
      />
    );
  } else if (tab.status !== 'open') {
    const merged = tab.status === 'merged' && tab.merged_into_ulid;
    content = (
      <EmptyState
        title={tab.status === 'merged' ? 'This bill was merged' : 'This bill is closed'}
        message={merged ? 'Its items moved to another table’s bill.' : `${tableLabel(tab.table.name)} is free again.`}
        icon="checkmark-done-outline"
        actionLabel={merged ? 'Open the merged bill' : 'Back to tables'}
        onAction={merged ? () => router.replace(tabRoute(tab.merged_into_ulid ?? '')) : backToTables}
        testID="tab-closed"
      />
    );
  } else {
    content = (
      <CartStoreProvider value={state.round}>
        <OpenTab state={state} tab={tab} />
      </CartStoreProvider>
    );
  }

  const header =
    tab && tab.status === 'open' && state.online ? null : (
      <TopBar
        title={tab ? tableLabel(tab.table.name) : 'Bill'}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back to tables" onPress={backToTables} testID="tab-back" />}
        testID="tab-header"
      />
    );

  return (
    <Screen edges={[]} testID="tab-screen">
      {header}
      {header ? (
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
          {content}
        </SafeAreaView>
      ) : (
        content
      )}
      <TabStateDialogs state={state} tab={tab} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  search: {
    paddingTop: spacing.sm,
    maxWidth: layout.searchMaxWidth + 2 * spacing.xxl,
  },
});
