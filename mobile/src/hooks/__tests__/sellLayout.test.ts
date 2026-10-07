/**
 * The Sell layout with the cart (contract → Core Sale → App → Sell screen):
 * a permanently visible side panel on tablet landscape; a bottom bar on
 * phones and in portrait. Tiles never get narrower than the theme minimum.
 */
import { layout, sidebar, spacing } from '@/constants/theme';
import { getResponsive, sellLayoutFor } from '@/hooks/useResponsive';
import { REFERENCE_SIZES } from '@/test-utils';

const EXPANDED = sidebar.outerMargin + sidebar.widthExpanded;
const RAIL = sidebar.outerMargin + sidebar.widthRail;

function at(size: { width: number; height: number }, cart: boolean, sidebarWidth: number) {
  return sellLayoutFor(getResponsive(size.width, size.height), { cart, sidebarWidth });
}

describe('sellLayoutFor', () => {
  it('tablet landscape: the cart is a side panel, never a bar', () => {
    for (const sidebarWidth of [0, RAIL, EXPANDED]) {
      expect(at(REFERENCE_SIZES.tabletLandscape, true, sidebarWidth)).toMatchObject({ cartSide: true, cartBar: false });
    }
  });

  it.each([
    ['phone portrait', REFERENCE_SIZES.phonePortrait, 0],
    ['small phone portrait', REFERENCE_SIZES.phonePortraitSmall, 0],
    ['phone landscape', REFERENCE_SIZES.phoneLandscape, RAIL],
    ['small phone landscape', REFERENCE_SIZES.phoneLandscapeSmall, RAIL],
    ['tablet portrait', REFERENCE_SIZES.tabletPortrait, RAIL],
  ])('%s: a bottom bar opens the cart', (_label, size, sidebarWidth) => {
    expect(at(size, true, sidebarWidth)).toMatchObject({ cartSide: false, cartBar: true });
  });

  it('without a cart (no `sale.create`) there is neither, and the Phase 2 layout stays', () => {
    // 1280 − 252 (expanded sidebar) − 220 (rail) − 48 (padding) = 760: 4 tiles of 175.
    expect(at(REFERENCE_SIZES.tabletLandscape, false, EXPANDED)).toEqual({
      cartSide: false,
      cartBar: false,
      categoryRailSide: true,
      tileColumns: 4,
    });
    expect(at(REFERENCE_SIZES.tabletLandscape, false, 0)).toMatchObject({ categoryRailSide: true, tileColumns: 4 });
    expect(at(REFERENCE_SIZES.phonePortrait, false, 0)).toMatchObject({ categoryRailSide: false, tileColumns: 2 });
    expect(at(REFERENCE_SIZES.tabletPortrait, false, RAIL)).toMatchObject({ categoryRailSide: false, tileColumns: 3 });
  });

  it('tablet landscape with the cart and the wide sidebar: the categories move to chips and the tiles keep 3 columns', () => {
    expect(at(REFERENCE_SIZES.tabletLandscape, true, EXPANDED)).toMatchObject({ categoryRailSide: false, tileColumns: 3 });
    // With the sidebar collapsed to its rail, the side category rail fits again.
    expect(at(REFERENCE_SIZES.tabletLandscape, true, RAIL)).toMatchObject({ categoryRailSide: true, tileColumns: 3 });
  });

  it('never makes tiles narrower than the minimum, nor fewer than 2 per row', () => {
    for (const [size, sidebarWidth] of [
      [REFERENCE_SIZES.tabletLandscape, EXPANDED],
      [REFERENCE_SIZES.tabletLandscape, RAIL],
      [REFERENCE_SIZES.tabletPortrait, RAIL],
      [REFERENCE_SIZES.phoneLandscape, RAIL],
      [REFERENCE_SIZES.phonePortrait, 0],
    ] as const) {
      const responsive = getResponsive(size.width, size.height);
      const result = sellLayoutFor(responsive, { cart: true, sidebarWidth });
      const width =
        size.width -
        sidebarWidth -
        (result.cartSide ? layout.cartPanelWidth : 0) -
        (result.categoryRailSide ? layout.categoryRailWidth : 0) -
        2 * responsive.screenPaddingX;
      const tile = (width - (result.tileColumns - 1) * responsive.gutter) / result.tileColumns;
      expect(result.tileColumns).toBeGreaterThanOrEqual(2);
      if (result.tileColumns > 2) expect(tile).toBeGreaterThanOrEqual(layout.sellTileMinWidth);
    }
    expect(spacing.xxl).toBe(24);
  });
});
