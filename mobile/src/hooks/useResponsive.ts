import { useWindowDimensions } from 'react-native';

import { layout, sizes, spacing } from '@/constants/theme';

/**
 * How the app-shell sidebar shows (MASTER §2.2 / §6):
 * - `rail`: the persistent 64 dp icon rail (tablets in both orientations, phone
 *   landscape); its chevron opens the 256 dp labelled panel as an overlay
 * - `drawer`: no persistent sidebar; a ☰ button opens a slide-in drawer (phone portrait)
 */
export type SidebarMode = 'rail' | 'drawer';

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
  /** Height of the header, without the safe area: 56 on phones, 48 on tablets (MASTER §6). */
  topBarHeight: number;
  /** The top bar shows its optional subtitle (tablets, not on short landscape heights). */
  showBarSubtitle: boolean;
  /** Top-bar status chips show a short text label (tablets and landscape); else icon-only. */
  statusChipLabels: boolean;
  /** App-shell sidebar mode for this size (see `SidebarMode`). */
  sidebarMode: SidebarMode;
  /** The decorative header band's height (MASTER §2.3 / §6): 200 on tablets, 120 below 600 dp of height and on phones. */
  bandHeight: number;
  /** The band's title uses the compact size (short heights). */
  bandCompact: boolean;
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
  /** Back-office lists (MASTER §6): the data table on tablets in landscape; cards in portrait and on phones. */
  listTable: boolean;
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

  const sidebarMode: SidebarMode = isTablet || isLandscape ? 'rail' : 'drawer';
  const bandCompact = !isTablet || height < layout.bandShortMaxHeight;

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
    bandHeight: bandCompact ? sizes.band.short : sizes.band.regular,
    bandCompact,
    kpiColumns,
    dashboardColumns: columns,
    tileColumns,
    listTable: isTablet && isLandscape,
  };
}

/**
 * Dashboard section columns once the sidebar is known: a wide persistent
 * sidebar leaves room for 2 readable chart columns, the rail for 3. Every
 * other size uses `dashboardColumns` as is. (The tablet rail is always 64 dp
 * since MASTER §6, so `sidebarExpanded` is false in the app shell.)
 */
export function dashboardColumnsFor(responsive: Responsive, sidebarExpanded: boolean): 1 | 2 | 3 {
  if (responsive.dashboardColumns === 3 && sidebarExpanded) return 2;
  return responsive.dashboardColumns;
}

export type SellLayout = {
  /** Tablet landscape: the Current Order card is a fixed 360 dp column on the right, never hidden. */
  cartSide: boolean;
  /** Tablet portrait: the Current Order card sits under the menu, always visible (sell.md). */
  cartBelow: boolean;
  /** Phones: no room for the card, so the bottom bar opens it in a sheet. */
  cartBar: boolean;
  /** The pinned bottom bar "n items · ₱total · Checkout" (tablet portrait and phones). */
  checkoutBar: boolean;
  /** Product tiles per row. */
  tileColumns: 2 | 3 | 4;
};

/**
 * The Sell screen's layout once the cart and the app-shell sidebar are known
 * (design-system/pos/pages/sell.md):
 * - tablet landscape: the menu, then the Current Order card fixed at 360;
 *   4 tile columns;
 * - tablet portrait: the menu above the always-visible card, and a pinned
 *   bottom bar with **Checkout**; 3 tile columns;
 * - phones: the bottom bar opens the card in a sheet (no room to show it), its
 *   **Checkout** goes straight to checkout; as many columns as fit at
 *   `layout.sellTileMinWidth` (2 or 3).
 * The cart parts only show for users who get a cart (`sale.create`).
 */
export function sellLayoutFor(responsive: Responsive, options: { cart: boolean; sidebarWidth: number }): SellLayout {
  const { cart } = options;
  const cartSide = cart && responsive.isTablet && responsive.isLandscape;
  const cartBelow = cart && responsive.isTablet && responsive.isPortrait;
  const cartBar = cart && responsive.isPhone;

  let tileColumns: 2 | 3 | 4 = responsive.tileColumns;
  if (responsive.isPhone) {
    const available = responsive.width - options.sidebarWidth - 2 * responsive.screenPaddingX;
    const columns = Math.floor((available + responsive.gutter) / (layout.sellTileMinWidth + responsive.gutter));
    tileColumns = Math.max(2, Math.min(responsive.tileColumns, columns)) as 2 | 3 | 4;
  }

  return { cartSide, cartBelow, cartBar, checkoutBar: cartBelow || cartBar, tileColumns };
}

/**
 * The single source of layout decisions. Re-renders on rotation / window
 * resize (via `useWindowDimensions`), so layouts re-flow in place.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return getResponsive(width, height);
}
