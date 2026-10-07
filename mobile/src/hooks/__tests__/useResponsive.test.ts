import { act, renderHook } from '@testing-library/react-native';

import { dashboardColumnsFor, getResponsive, useResponsive } from '@/hooks/useResponsive';
import { REFERENCE_SIZES, resetWindowSize, setWindowSize } from '@/test-utils';

afterEach(() => {
  resetWindowSize();
});

const cases = [
  // name, width, height, isLandscape, isSmallPhone, isTablet, isCompactHeight, columns
  ['phone portrait (small)', 360, 640, false, true, false, false, 1],
  ['phone landscape (small)', 640, 360, true, false, false, true, 2],
  ['phone portrait', 430, 932, false, false, false, false, 1],
  ['phone landscape', 932, 430, true, false, false, true, 2],
  ['tablet portrait', 800, 1280, false, false, true, false, 2],
  ['tablet landscape', 1280, 800, true, false, true, false, 3],
] as const;

describe('useResponsive', () => {
  it.each(cases)(
    '%s (%i×%i)',
    async (_name, width, height, isLandscape, isSmallPhone, isTablet, isCompactHeight, columns) => {
      setWindowSize(width, height);

      const { result } = await renderHook(() => useResponsive());

      expect(result.current).toMatchObject({
        width,
        height,
        isLandscape,
        isSmallPhone,
        isTablet,
        isCompactHeight,
        columns,
        isTwoPane: isTablet && isLandscape,
        formMaxWidth: 480,
      });
    },
  );

  it('re-renders with the new layout when the device rotates', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);
    const { result } = await renderHook(() => useResponsive());
    expect(result.current.columns).toBe(2);

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    });

    expect(result.current.isLandscape).toBe(true);
    expect(result.current.columns).toBe(3);
  });

  it('shrinks paddings on compact heights and grows them a little on tablets', () => {
    const phone = getResponsive(430, 932);
    const compact = getResponsive(932, 430);
    const tablet = getResponsive(1280, 800);

    expect(compact.screenPaddingY).toBeLessThan(phone.screenPaddingY);
    expect(compact.headerPaddingY).toBeLessThan(phone.headerPaddingY);
    expect(compact.gutter).toBeLessThan(phone.gutter);
    expect(tablet.screenPaddingX).toBeGreaterThan(phone.screenPaddingX);
    expect(tablet.gutter).toBeGreaterThan(phone.gutter);
    expect(tablet.contentMaxWidth).toBe(1200);
  });

  it.each([
    // name, width, height, sidebarMode, kpiColumns, dashboardColumns
    ['phone portrait (small)', 360, 640, 'drawer', 2, 1],
    ['phone portrait', 430, 932, 'drawer', 2, 1],
    ['phone landscape (small)', 640, 360, 'rail', 3, 2],
    ['phone landscape', 932, 430, 'rail', 3, 2],
    ['tablet portrait', 800, 1280, 'rail', 3, 2],
    ['tablet landscape', 1280, 800, 'expanded', 5, 3],
  ] as const)('%s: sidebar %s, %i KPI tiles, %i dashboard columns', (_name, width, height, sidebarMode, kpiColumns, dashboardColumns) => {
    expect(getResponsive(width, height)).toMatchObject({ sidebarMode, kpiColumns, dashboardColumns });
  });

  it.each([
    // name, width, height, tileColumns, categoryRailSide
    ['phone portrait (small)', 360, 640, 2, false],
    ['phone portrait', 430, 932, 2, false],
    ['phone landscape (small)', 640, 360, 3, false],
    ['phone landscape', 932, 430, 3, false],
    ['tablet portrait', 800, 1280, 3, false],
    ['tablet landscape', 1280, 800, 4, true],
  ] as const)('%s: %i Sell tiles per row, side category rail %s', (_name, width, height, tileColumns, categoryRailSide) => {
    expect(getResponsive(width, height)).toMatchObject({ tileColumns, categoryRailSide });
  });

  it('gives the dashboard 2 columns on tablet landscape while the expanded sidebar takes its width', () => {
    const tabletLandscape = getResponsive(1280, 800);
    expect(dashboardColumnsFor(tabletLandscape, true)).toBe(2);
    expect(dashboardColumnsFor(tabletLandscape, false)).toBe(3);
    expect(dashboardColumnsFor(getResponsive(800, 1280), false)).toBe(2);
    expect(dashboardColumnsFor(getResponsive(430, 932), false)).toBe(1);
  });
});
