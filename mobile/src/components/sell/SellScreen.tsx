import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrintFailureBanner } from '@/components/printing/PrintFailureBanner';
import { CategoryRail } from '@/components/sell/CategoryRail';
import { LineEditorDialog } from '@/components/sell/LineEditorDialog';
import { ProductTileGrid, type TileGridEmpty } from '@/components/sell/ProductTileGrid';
import { ProductTileSkeleton } from '@/components/sell/ProductTileSkeleton';
import { SellCartArea } from '@/components/sell/SellCartArea';
import { SellHeader } from '@/components/sell/SellHeader';
import { OpenShiftGate } from '@/components/shifts/OpenShiftGate';
import { ShiftDialogs } from '@/components/shifts/ShiftDialogs';
import { useShell } from '@/components/shell/ShellContext';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Screen } from '@/components/ui/Screen';
import { spacing } from '@/constants/theme';
import type { MenuProduct } from '@/db/menuQueries';
import { useCartEditors } from '@/hooks/sell/useCartEditors';
import { useSellScreen, type SellScreenState } from '@/hooks/sell/useSellScreen';
import { useShiftControls } from '@/hooks/shifts/useShiftControls';
import { sellLayoutFor, useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

const SYNC_FAILED_FALLBACK = "Couldn't sync the menu. Please try again.";

type SellBodyProps = {
  screen: SellScreenState;
  columns: number;
  onPressTile?: (product: MenuProduct) => void;
  /** A tile tap that couldn't add (e.g. the 100-line limit). */
  notice: string | null;
  padBottomInset: boolean;
  showCartQty: boolean;
};

/** The menu area below the filters: every state of the local menu and of the sync. */
function SellBody({ screen, columns, onPressTile, notice, padBottomInset, showCartQty }: SellBodyProps) {
  const { menu, sync, filtersActive, setSearch, setCategoryId } = screen;
  const { screenPaddingX } = useResponsive();

  const empty: TileGridEmpty = useMemo(
    () =>
      filtersActive
        ? {
            title: 'No matching items',
            message: 'Try another name or SKU, or choose another category.',
            icon: 'search-outline',
            actionLabel: 'Show all items',
            onAction: () => {
              setSearch('');
              setCategoryId(null);
            },
          }
        : {
            title: 'No items on the menu yet',
            message: 'Items added in Menu show here after the next sync.',
            icon: 'fast-food-outline',
          },
    [filtersActive, setSearch, setCategoryId],
  );

  if (menu.error) {
    return <ErrorState title="Couldn't open the menu" message={menu.error} onRetry={menu.reload} testID="sell-menu-error" />;
  }

  if (menu.loading) return <ProductTileSkeleton columns={columns} message="Loading the menu…" testID="sell-loading" />;

  // Nothing stored on this device yet.
  if (!menu.hasData) {
    if (sync.status === 'syncing') {
      return <ProductTileSkeleton columns={columns} message="Downloading the menu…" showMessage testID="sell-first-sync" />;
    }
    if (sync.status === 'error') {
      return (
        <ErrorState
          title="Couldn't sync the menu"
          message={sync.error ?? SYNC_FAILED_FALLBACK}
          onRetry={screen.syncNow}
          retryLabel="Sync now"
          testID="sell-sync-error"
        />
      );
    }
    return (
      <EmptyState
        title="Menu not synced yet"
        message={
          sync.status === 'offline'
            ? 'This device is offline. Connect to the network, then sync to download the menu.'
            : 'Download the menu to this device to start.'
        }
        icon="cloud-download-outline"
        actionLabel="Sync now"
        onAction={screen.syncNow}
        testID="sell-not-synced"
      />
    );
  }

  // A failed sync keeps the last good menu on screen, with the message and a retry.
  const showBanners = notice !== null || sync.status === 'error';

  return (
    <>
      {showBanners ? (
        <View style={[styles.banners, { paddingHorizontal: screenPaddingX }]}>
          {notice ? <Banner variant="warning" message={notice} testID="sell-notice" /> : null}
          {sync.status === 'error' ? (
            <View style={styles.syncError} testID="sell-sync-error">
              <Banner message={sync.error ?? SYNC_FAILED_FALLBACK} />
              <Button
                title="Sync now"
                leftIcon="sync"
                variant="secondary"
                onPress={screen.syncNow}
                style={styles.syncErrorButton}
                testID="sell-sync-error-action"
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <ProductTileGrid
        products={menu.products}
        columns={columns}
        onPressTile={onPressTile}
        padBottomInset={padBottomInset}
        onRefresh={screen.refresh}
        empty={empty}
        showCartQty={showCartQty}
      />
    </>
  );
}

/**
 * Sell (POS board). The menu is read **only** from the on-device SQLite menu
 * (category filter, search by name or SKU, product tiles with their
 * "Unavailable" / stock states). Users with `sale.create` also get the cart:
 * a tap on an available tile adds one; everyone else keeps the read-only screen.
 *
 * Layout (from `sellLayoutFor`, built on `useResponsive`):
 * - tablet landscape: the order panel is a **permanently visible**, full-height
 *   column on the right (never hidden behind a breakpoint); the top bar
 *   (search + status chips) and the tiles take the rest. The category rail
 *   stays at the side while the tiles still get 3 columns, else it becomes
 *   the pill row above the tiles.
 * - phones and portrait: a floating dark "View order" bar opens the cart in
 *   a sheet, and each tile shows its in-cart count.
 * Printing (Phase 4): a failure banner above the menu and a printer chip in
 * the top bar. Shifts (Phase 6): with `sale.create`, sales need this tablet's
 * open shift; without one the body is the **Open a shift** gate.
 *
 * Speed: this component never subscribes to the cart (see `SellCartArea`),
 * and the tile handler is stable, so a cart change never re-renders the menu.
 * The filters, the tiles and the cart state live above every layout switch
 * and each part keeps its tree position, so rotating keeps the search, the
 * scroll position, the cart and any open editor.
 */
export function SellScreen() {
  const screen = useSellScreen();
  const responsive = useResponsive();
  const { sidebarWidth } = useShell();
  const canSell = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const shiftControls = useShiftControls();
  // Phase 6: no open shift on this tablet (or still reading it) → the gate instead of the menu and the cart.
  const gated = canSell && shiftControls.shift === null;
  const layout = sellLayoutFor(responsive, { cart: canSell && !gated, sidebarWidth });
  const editors = useCartEditors();
  const { categories } = screen.menu;

  // The side panel replaces the sheet: one left open when rotating to tablet landscape closes.
  if (layout.cartSide && editors.sheetOpen) editors.closeSheet();

  // A stable tile handler (the grid and tiles are memoised) that always calls the latest `addProduct`.
  const addProductRef = useRef(editors.addProduct);
  useEffect(() => {
    addProductRef.current = editors.addProduct;
  });
  const addProduct = useCallback((product: MenuProduct) => addProductRef.current(product), []);

  const showFilters = !gated && screen.menu.hasData && screen.menu.error === null;
  const search = useMemo(
    () => (showFilters ? { value: screen.search, onChange: screen.setSearch, searching: screen.searching } : null),
    [showFilters, screen.search, screen.setSearch, screen.searching],
  );

  return (
    <Screen edges={[]} testID="sell-screen">
      <View style={[styles.fill, layout.cartSide ? styles.row : styles.column]}>
        <View style={styles.fill}>
          <SellHeader
            sync={screen.sync}
            onSyncNow={screen.syncNow}
            shift={canSell ? shiftControls.shift : null}
            onOpenShiftMenu={() => shiftControls.show('menu')}
            search={search}
          />
          <SafeAreaView edges={['left', 'right']} style={styles.body}>
            {showFilters && layout.categoryRailSide ? (
              <CategoryRail variant="side" categories={categories} selectedId={screen.categoryId} onChange={screen.setCategoryId} />
            ) : null}
            <View style={styles.fill}>
              <PrintFailureBanner />
              {shiftControls.flash && !gated ? (
                <View style={[styles.flash, { paddingHorizontal: responsive.screenPaddingX }]}>
                  <Banner variant="success" message={shiftControls.flash} testID="shift-flash" />
                </View>
              ) : null}
              {showFilters && !layout.categoryRailSide ? (
                <CategoryRail variant="row" categories={categories} selectedId={screen.categoryId} onChange={screen.setCategoryId} />
              ) : null}
              {showFilters && layout.categoryRailSide ? <View style={styles.railGap} /> : null}
              {gated ? (
                <OpenShiftGate controls={shiftControls} />
              ) : (
                <SellBody
                  screen={screen}
                  columns={layout.tileColumns}
                  onPressTile={canSell ? addProduct : undefined}
                  notice={editors.notice}
                  padBottomInset={!layout.cartBar}
                  showCartQty={layout.cartBar}
                />
              )}
            </View>
          </SafeAreaView>
        </View>
        {canSell ? <SellCartArea layout={layout} editors={editors} /> : null}
      </View>

      {canSell ? (
        <>
          <ShiftDialogs controls={shiftControls} />
          <LineEditorDialog editors={editors} />
        </>
      ) : null}
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
  banners: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  flash: {
    paddingTop: spacing.md,
  },
  railGap: {
    height: spacing.lg,
  },
  syncError: {
    gap: spacing.sm,
  },
  syncErrorButton: {
    alignSelf: 'flex-start',
  },
});
