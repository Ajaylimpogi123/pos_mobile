import { useWindowDimensions } from 'react-native';

import { layout, sizes, spacing } from '@/constants/theme';

/**
 * How the app-shell sidebar shows by default:
 * - `expanded`: persistent, labelled panel (tablet landscape; the user may collapse it to the rail)
 * - `rail`: persistent icon rail (tablet portrait, phone landscape; its chevron expands it as an overlay)
 * - `drawer`: no persistent sidebar; a ☰ button opens a slide-in drawer (phone portrait)
 */
export type SidebarMode = 'expanded' | 'rail' | 'drawer';

export type Responsive = {
  width: number;
  height: number;
  /** min(width, height): stable across rotation. */
  shortSide: number;
  isLandscape: boolean;
  isPortrait: boolean;
  /** Width below 380. */
  isSmallPhone: boolean;
  /** Shortest side ≥ 600 (the primary device class). */
  isTablet: boolean;
  isPhone: boolean;
  /** Height below 480 (short landscape): headers and paddings shrink. */
  isCompactHeight: boolean;
  /** Card-grid columns: phone portrait 1, phone landscape 2, tablet portrait 2, tablet landscape 3. */
  columns: 1 | 2 | 3;
  /** Login shows the side brand panel + form (tablet landscape only). */
  isTwoPane: boolean;
  /** Max width of centred forms / the login card. */
  formMaxWidth: number;
  /** Max width of page content (grids, header content). */
  contentMaxWidth: number;
  /** Horizontal page padding. */
  screenPaddingX: number;
  /** Vertical page padding. */
  screenPaddingY: number;
  /** Gap between grid cards and between stacked sections. */
  gutter: number;
  /** Inner padding of a card. */
  cardPadding: number;
  /** Vertical padding of the toolbar row just below the top bar (search, tabs, chips). */
  headerPaddingY: number;
  /** Height of the compact top bar, without the safe area: 56 on phones, 64 on tablets. */
  topBarHeight: number;
  /** The top bar shows its optional subtitle (tablets, not on short landscape heights). */
  showBarSubtitle: boolean;
  /** Top-bar status chips show a short text label (tablets and landscape); else icon-only. */
  statusChipLabels: boolean;
  /** Default app-shell sidebar mode for this size (see `SidebarMode`). */
  sidebarMode: SidebarMode;
  /** Dashboard KPI tiles per row: phone portrait 2, phone landscape / tablet portrait 3, tablet landscape 5. */
  kpiColumns: 2 | 3 | 5;
  /**
   * Dashboard section columns: phone portrait 1, phone landscape / tablet
   * portrait 2, tablet landscape 3 (2 while the expanded sidebar takes its
   * width: see `dashboardColumnsFor`).
   */
  dashboardColumns: 1 | 2 | 3;
  /** Sell-screen product tiles per row: phone portrait 2, phone landscape / tablet portrait 3, tablet landscape 4. */
  tileColumns: 2 | 3 | 4;
  /**
   * Sell screen: the category rail is a vertical side column (tablet
   * landscape) instead of a horizontal chip row above the tiles.
   */
  categoryRailSide: boolean;
};

/**
 * Pure layout decisions for a window size. Exported for tests; screens use
 * `useResponsive()`.
 */
export function getResponsive(width: number, height: number): Responsive {
  const shortSide = Math.min(width, height);
  const isLandscape = width > height;
  const isTablet = shortSide >= layout.tabletMinShortSide;
  const isSmallPhone = width < layout.smallPhoneMaxWidth;
  const isCompactHeight = height < layout.compactMaxHeight;

  const columns: 1 | 2 | 3 = isTablet ? (isLandscape ? 3 : 2) : isLandscape ? 2 : 1;

  let sidebarMode: SidebarMode = 'drawer';
  if (isTablet) sidebarMode = isLandscape ? 'expanded' : 'rail';
  else if (isLandscape) sidebarMode = 'rail';

  let kpiColumns: 2 | 3 | 5 = 3;
  if (isTablet && isLandscape) kpiColumns = 5;
  else if (!isTablet && !isLandscape) kpiColumns = 2;

  let tileColumns: 2 | 3 | 4 = 3;
  if (isTablet && isLandscape) tileColumns = 4;
  else if (!isTablet && !isLandscape) tileColumns = 2;

  let screenPaddingX: number = spacing.lg;
  if (isTablet) screenPaddingX = spacing.xxl;
  else if (isSmallPhone) screenPaddingX = spacing.md;

  let screenPaddingY: number = spacing.lg;
  if (isCompactHeight) screenPaddingY = spacing.sm;
  else if (isTablet) screenPaddingY = spacing.xl;

  let gutter: number = spacing.lg;
  if (isCompactHeight) gutter = spacing.md;
  else if (isTablet) gutter = spacing.xl;

  let cardPadding: number = spacing.lg;
  if (isCompactHeight || isSmallPhone) cardPadding = spacing.md;
  else if (isTablet) cardPadding = spacing.xl;

  let headerPaddingY: number = spacing.md;
  if (isCompactHeight) headerPaddingY = spacing.sm;
  else if (isTablet) headerPaddingY = spacing.lg;

  return {
    width,
    height,
    shortSide,
    isLandscape,
    isPortrait: !isLandscape,
    isSmallPhone,
    isTablet,
    isPhone: !isTablet,
    isCompactHeight,
    columns,
    isTwoPane: isTablet && isLandscape,
    formMaxWidth: layout.formMaxWidth,
    contentMaxWidth: layout.contentMaxWidth,
    screenPaddingX,
    screenPaddingY,
    gutter,
    cardPadding,
    headerPaddingY,
    topBarHeight: isTablet ? sizes.topBar.tablet : sizes.topBar.phone,
    showBarSubtitle: isTablet && !isCompactHeight,
    statusChipLabels: isTablet || isLandscape,
    sidebarMode,
    kpiColumns,
    dashboardColumns: columns,
    tileColumns,
    categoryRailSide: isTablet && isLandscape,
  };
}

/**
 * Dashboard section columns once the sidebar is known: on tablet landscape the
 * persistent expanded sidebar (240) leaves room for 2 readable chart columns,
 * the collapsed rail for 3. Every other size uses `dashboardColumns` as is.
 */
export function dashboardColumnsFor(responsive: Responsive, sidebarExpanded: boolean): 1 | 2 | 3 {
  if (responsive.dashboardColumns === 3 && sidebarExpanded) return 2;
  return responsive.dashboardColumns;
}

export type SellLayout = {
  /** The cart is a permanently visible side panel (tablet landscape): never hidden behind a breakpoint. */
  cartSide: boolean;
  /** Phones and portrait: a bottom bar ("Cart · n items · ₱total") opens the cart. */
  cartBar: boolean;
  /** The category filter is a vertical rail beside the tiles (else a chip row above them). */
  categoryRailSide: boolean;
  /** Product tiles per row. */
  tileColumns: 2 | 3 | 4;
};

/**
 * The Sell screen's layout once the cart and the app-shell sidebar are known.
 * - The cart: a side panel on tablet landscape, a bottom bar everywhere else
 *   (only for users who get a cart, i.e. with `sale.create`).
 * - Tiles: as many columns as fit at `layout.sellTileMinWidth`, capped by
 *   `tileColumns` (2 / 3 / 4 by size), never fewer than 2.
 * - The side category rail stays on tablet landscape while the tiles beside
 *   it still get 3 columns; when the cart panel and a wide sidebar leave less
 *   room, the categories become the chip row above the tiles instead.
 */
export function sellLayoutFor(responsive: Responsive, options: { cart: boolean; sidebarWidth: number }): SellLayout {
  const cartSide = options.cart && responsive.isTablet && responsive.isLandscape;
  const available =
    responsive.width - options.sidebarWidth - (cartSide ? layout.cartPanelWidth : 0) - 2 * responsive.screenPaddingX;

  const fit = (width: number): 2 | 3 | 4 => {
    const columns = Math.floor((width + responsive.gutter) / (layout.sellTileMinWidth + responsive.gutter));
    return Math.max(2, Math.min(responsive.tileColumns, columns)) as 2 | 3 | 4;
  };

  let categoryRailSide = responsive.categoryRailSide;
  if (categoryRailSide && cartSide && fit(available - layout.categoryRailWidth) < 3) categoryRailSide = false;

  return {
    cartSide,
    cartBar: options.cart && !cartSide,
    categoryRailSide,
    tileColumns: fit(available - (categoryRailSide ? layout.categoryRailWidth : 0)),
  };
}

/**
 * The single source of layout decisions. Re-renders on rotation / window
 * resize (via `useWindowDimensions`), so layouts re-flow in place.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return getResponsive(width, height);
}
