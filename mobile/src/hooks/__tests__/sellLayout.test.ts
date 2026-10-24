/**
 * The Sell layout with the cart (design-system/pos/pages/sell.md): the
 * Current Order card is a fixed 360 dp column on tablet landscape (4 tile
 * columns), sits under the menu on tablet portrait with a pinned Checkout bar
 * (3 columns), and opens from the bottom bar in a sheet on phones. The cart
 * is never hidden on a tablet.
 */
import { layout, sidebar } from '@/constants/theme';
import { getResponsive, sellLayoutFor } from '@/hooks/useResponsive';
import { REFERENCE_SIZES } from '@/test-utils';

const RAIL = sidebar.outerMargin + sidebar.widthRail;

function at(size: { width: number; height: number }, cart: boolean, sidebarWidth: number) {
  return sellLayoutFor(getResponsive(size.width, size.height), { cart, sidebarWidth });
}

describe('sellLayoutFor', () => {
  it('tablet landscape: the card is the side column (360), with 4 tile columns and no bar', () => {
    expect(layout.cartPanelWidth).toBe(360);
    for (const sidebarWidth of [0, RAIL]) {
      expect(at(REFERENCE_SIZES.tabletLandscape, true, sidebarWidth)).toEqual({
        cartSide: true,
        cartBelow: false,
        cartBar: false,
        checkoutBar: false,
        tileColumns: 4,
      });
    }
  });

  it('tablet portrait: the card sits under the menu (always visible), with the pinned Checkout bar and 3 columns', () => {
    expect(at(REFERENCE_SIZES.tabletPortrait, true, RAIL)).toEqual({
      cartSide: false,
      cartBelow: true,
      cartBar: false,
      checkoutBar: true,
      tileColumns: 3,
    });
  });

  it.each([
    ['phone portrait', REFERENCE_SIZES.phonePortrait, 0],
    ['small phone portrait', REFERENCE_SIZES.phonePortraitSmall, 0],
    ['phone landscape', REFERENCE_SIZES.phoneLandscape, RAIL],
    ['small phone landscape', REFERENCE_SIZES.phoneLandscapeSmall, RAIL],
  ])('%s: the bottom bar opens the card in a sheet and has Checkout', (_label, size, sidebarWidth) => {
    expect(at(size, true, sidebarWidth)).toMatchObject({ cartSide: false, cartBelow: false, cartBar: true, checkoutBar: true });
  });

  it('without a cart (no `sale.create`) there is no card and no bar; the columns stay', () => {
    expect(at(REFERENCE_SIZES.tabletLandscape, false, RAIL)).toEqual({
      cartSide: false,
      cartBelow: false,
      cartBar: false,
      checkoutBar: false,
      tileColumns: 4,
    });
    expect(at(REFERENCE_SIZES.tabletPortrait, false, RAIL)).toMatchObject({ tileColumns: 3 });
    expect(at(REFERENCE_SIZES.phonePortrait, false, 0)).toMatchObject({ tileColumns: 2 });
  });

  it('phones never make tiles narrower than the minimum, nor fewer than 2 per row', () => {
    for (const [size, sidebarWidth] of [
      [REFERENCE_SIZES.phoneLandscape, RAIL],
      [REFERENCE_SIZES.phoneLandscapeSmall, RAIL],
      [REFERENCE_SIZES.phonePortrait, 0],
      [REFERENCE_SIZES.phonePortraitSmall, 0],
    ] as const) {
      const responsive = getResponsive(size.width, size.height);
      const result = sellLayoutFor(responsive, { cart: true, sidebarWidth });
      const width = size.width - sidebarWidth - 2 * responsive.screenPaddingX;
      const tile = (width - (result.tileColumns - 1) * responsive.gutter) / result.tileColumns;
      expect(result.tileColumns).toBeGreaterThanOrEqual(2);
      if (result.tileColumns > 2) expect(tile).toBeGreaterThanOrEqual(layout.sellTileMinWidth);
    }
  });
});
