import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import { MenuButton } from '@/components/shell/MenuButton';
import { activeModuleKey, visibleModuleGroups } from '@/constants/modules';
import { getResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import {
  cashierUser,
  installFetchMock,
  mockResponse,
  REFERENCE_SIZES,
  resetWindowSize,
  secureStoreMock,
  setWindowSize,
} from '@/test-utils';
import { managerUser } from '@/test-utils/catalog';

const FUTURE = '2026-09-25T01:30:00Z';
const pathname = usePathname as jest.Mock;

/** A content screen with its own state, to prove the shell never remounts it. */
function Content() {
  const [taps, setTaps] = useState(0);
  return (
    <>
      <MenuButton />
      <Pressable onPress={() => setTaps(taps + 1)} testID="content-counter">
        <Text>Taps: {taps}</Text>
      </Pressable>
    </>
  );
}

async function renderShell() {
  return render(
    <AppShell>
      <Content />
    </AppShell>,
  );
}

function setSize(size: { width: number; height: number }) {
  setWindowSize(size.width, size.height);
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  pathname.mockReturnValue('/');
  (router.navigate as jest.Mock).mockClear();
});

afterEach(() => {
  resetWindowSize();
});

describe('sidebar modes per size', () => {
  it.each([
    ['phone portrait', REFERENCE_SIZES.phonePortrait, 'drawer'],
    ['small phone portrait', REFERENCE_SIZES.phonePortraitSmall, 'drawer'],
    ['phone landscape', REFERENCE_SIZES.phoneLandscape, 'rail'],
    ['small phone landscape', REFERENCE_SIZES.phoneLandscapeSmall, 'rail'],
    ['tablet portrait', REFERENCE_SIZES.tabletPortrait, 'rail'],
    ['tablet landscape', REFERENCE_SIZES.tabletLandscape, 'expanded'],
  ])('%s → %s', async (_label, size, mode) => {
    expect(getResponsive(size.width, size.height).sidebarMode).toBe(mode);

    setSize(size);
    await renderShell();

    if (mode === 'drawer') {
      expect(screen.queryByTestId('sidebar-expanded')).toBeNull();
      expect(screen.queryByTestId('sidebar-rail')).toBeNull();
      expect(screen.getByTestId('open-navigation')).toBeOnTheScreen();
    } else {
      expect(screen.getByTestId(`sidebar-${mode}`)).toBeOnTheScreen();
      expect(screen.queryByTestId('open-navigation')).toBeNull();
    }
  });

  it('tablet landscape: the chevron collapses to the rail and back, and the choice is remembered', async () => {
    const store = secureStoreMock();
    await renderShell();

    await fireEvent.press(screen.getByTestId('sidebar-chevron'));
    expect(screen.getByTestId('sidebar-rail')).toBeOnTheScreen();
    expect(store.setItemAsync).toHaveBeenCalledWith('pos.ui.sidebar_collapsed', '1');

    await fireEvent.press(screen.getByTestId('sidebar-chevron'));
    expect(screen.getByTestId('sidebar-expanded')).toBeOnTheScreen();
    expect(store.setItemAsync).toHaveBeenLastCalledWith('pos.ui.sidebar_collapsed', '0');
  });

  it('starts collapsed when that was the saved preference, and falls back to expanded if storage fails', async () => {
    await secureStoreMock().setItemAsync('pos.ui.sidebar_collapsed', '1');
    const first = await renderShell();
    expect(await screen.findByTestId('sidebar-rail')).toBeOnTheScreen();
    await first.unmount();

    secureStoreMock().getItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await renderShell();
    expect(screen.getByTestId('sidebar-expanded')).toBeOnTheScreen();
  });

  it('tablet portrait: the rail chevron opens the expanded panel as an overlay; the scrim closes it', async () => {
    setSize(REFERENCE_SIZES.tabletPortrait);
    await renderShell();

    await fireEvent.press(screen.getByTestId('sidebar-chevron'));
    const overlay = screen.getByTestId('nav-overlay');
    expect(within(overlay).getByTestId('sidebar-item-customers')).toHaveTextContent(/Customers$/);

    await fireEvent.press(screen.getByTestId('nav-overlay-scrim', { includeHiddenElements: true }));
    await waitFor(() => expect(screen.queryByTestId('nav-overlay')).toBeNull());
    expect(screen.getByTestId('sidebar-rail')).toBeOnTheScreen();
  });

  it('phone portrait: ☰ opens the drawer; choosing an item navigates and closes it', async () => {
    setSize(REFERENCE_SIZES.phonePortrait);
    await renderShell();

    await fireEvent.press(screen.getByTestId('open-navigation'));
    const drawer = screen.getByTestId('nav-drawer');
    expect(within(drawer).getByTestId('sidebar-footer')).toHaveTextContent(/Mia Manager/);

    await fireEvent.press(within(drawer).getByTestId('sidebar-item-customers'));
    expect(router.navigate).toHaveBeenCalledWith('/customers');
    await waitFor(() => expect(screen.queryByTestId('nav-drawer')).toBeNull());
  });

  it('phone portrait: the drawer\'s close button and the scrim close it', async () => {
    setSize(REFERENCE_SIZES.phonePortrait);
    await renderShell();

    await fireEvent.press(screen.getByTestId('open-navigation'));
    await fireEvent.press(within(screen.getByTestId('nav-drawer')).getByTestId('sidebar-chevron'));
    await waitFor(() => expect(screen.queryByTestId('nav-drawer')).toBeNull());

    await fireEvent.press(screen.getByTestId('open-navigation'));
    // The scrim fades in with the native driver (not run by Jest), so it is still at opacity 0 here.
    await fireEvent.press(screen.getByTestId('nav-drawer-scrim', { includeHiddenElements: true }));
    await waitFor(() => expect(screen.queryByTestId('nav-drawer')).toBeNull());
  });

  it('re-lays out in place on rotation: the content keeps its state', async () => {
    await renderShell();
    await fireEvent.press(screen.getByTestId('content-counter'));
    await fireEvent.press(screen.getByTestId('content-counter'));
    expect(screen.getByTestId('content-counter')).toHaveTextContent('Taps: 2');

    await act(async () => setSize(REFERENCE_SIZES.phonePortrait));
    expect(screen.queryByTestId('sidebar-expanded')).toBeNull();
    expect(screen.getByTestId('content-counter')).toHaveTextContent('Taps: 2');

    await act(async () => setSize(REFERENCE_SIZES.tabletPortrait));
    expect(screen.getByTestId('sidebar-rail')).toBeOnTheScreen();
    expect(screen.getByTestId('content-counter')).toHaveTextContent('Taps: 2');
  });
});

describe('sidebar modules', () => {
  it('shows every permitted module to a manager, in the grouped order', async () => {
    await renderShell();

    const ids = screen.getAllByTestId(/^sidebar-item-[a-z_]+$/).map((item) => item.props.testID);
    expect(ids).toEqual([
      'sidebar-item-dashboard',
      'sidebar-item-sell',
      'sidebar-item-orders',
      'sidebar-item-shifts',
      'sidebar-item-menu',
      // Ingredients, Recipes & Purchasing: Ingredients in Catalogue, and the Purchasing group.
      'sidebar-item-ingredients',
      'sidebar-item-inventory',
      'sidebar-item-purchase_requests',
      'sidebar-item-purchase_orders',
      'sidebar-item-receiving',
      'sidebar-item-suppliers',
      'sidebar-item-customers',
      'sidebar-item-staff',
      'sidebar-item-reports',
      'sidebar-item-printers',
      'sidebar-item-settings',
      'sidebar-item-sync',
    ]);
    for (const group of ['main', 'catalogue', 'purchasing', 'people', 'insights', 'system']) {
      expect(screen.getByTestId(`sidebar-group-${group}`)).toBeOnTheScreen();
    }
  });

  it('hides Menu, Inventory and Staff from a cashier, who still sees Sell, Orders and Customers (not Shifts or Reports)', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await renderShell();

    expect(screen.queryByTestId('sidebar-item-menu')).toBeNull();
    expect(screen.queryByTestId('sidebar-item-staff')).toBeNull();
    expect(screen.getByTestId('sidebar-item-customers')).toBeOnTheScreen();
    // Sell is ready for every signed-in user since Phase 2; Orders since Phase 3 (the cashier has `sale.create`).
    for (const key of ['sell', 'orders']) {
      expect(screen.getByTestId(`sidebar-item-${key}`)).not.toBeDisabled();
      expect(screen.queryByTestId(`sidebar-item-${key}-soon`)).toBeNull();
    }
    // Inventory (v1 completion) is ready, for `inventory.adjust` or `report.view` only.
    expect(screen.queryByTestId('sidebar-item-inventory')).toBeNull();
    // Phase 6: Shifts (`report.zread`) and Reports (`report.view`) are ready, and hidden from a cashier.
    expect(screen.queryByTestId('sidebar-item-shifts')).toBeNull();
    expect(screen.queryByTestId('sidebar-item-reports')).toBeNull();
    // The catalogue group (Menu, Ingredients, Inventory) and Purchasing are empty for a cashier, so they are dropped.
    expect(screen.queryByTestId('sidebar-item-ingredients')).toBeNull();
    expect(screen.queryByTestId('sidebar-item-purchase_requests')).toBeNull();
    expect(visibleModuleGroups(cashierUser).map((group) => group.key)).toEqual(['main', 'people', 'system']);
  });

  it('Inventory is ready: it navigates to /inventory for report.view alone too, and marks /inventory/9 active', async () => {
    await renderShell();

    const inventory = screen.getByTestId('sidebar-item-inventory');
    expect(inventory).not.toBeDisabled();
    expect(screen.queryByTestId('sidebar-item-inventory-soon')).toBeNull();
    await fireEvent.press(inventory);
    expect(router.navigate).toHaveBeenLastCalledWith('/inventory');
    expect(activeModuleKey('/inventory/9')).toBe('inventory');
    expect(
      visibleModuleGroups({ ...cashierUser, permissions: ['report.view'] })
        .flatMap((group) => group.modules.map((module) => module.key))
        .includes('inventory'),
    ).toBe(true);
  });

  it('marks the active module from the current path (selected state)', async () => {
    pathname.mockReturnValue('/staff/3');
    await renderShell();

    expect(screen.getByTestId('sidebar-item-staff')).toBeSelected();
    expect(screen.getByTestId('sidebar-item-dashboard')).not.toBeSelected();
    expect(activeModuleKey('/')).toBe('dashboard');
    expect(activeModuleKey('/menu/categories/2')).toBe('menu');
    expect(activeModuleKey('/customers')).toBe('customers');
    expect(activeModuleKey('/sell')).toBe('sell');
    expect(activeModuleKey('/menu-something')).toBe('dashboard');
  });

  it('navigates to a ready module; pressing the active root module does nothing', async () => {
    await renderShell();

    await fireEvent.press(screen.getByTestId('sidebar-item-menu'));
    expect(router.navigate).toHaveBeenLastCalledWith('/menu/products');
    await fireEvent.press(screen.getByTestId('sidebar-item-staff'));
    expect(router.navigate).toHaveBeenLastCalledWith('/staff');
    await fireEvent.press(screen.getByTestId('sidebar-item-sell'));
    expect(router.navigate).toHaveBeenLastCalledWith('/sell');

    (router.navigate as jest.Mock).mockClear();
    await fireEvent.press(screen.getByTestId('sidebar-item-dashboard'));
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('every item is at least 44×44', async () => {
    await renderShell();
    const flatten = (style: unknown): Record<string, number> =>
      Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : ((style ?? {}) as Record<string, number>);

    const pill = flatten(screen.getByTestId('sidebar-item-customers').props.style);
    expect(pill.minHeight).toBeGreaterThanOrEqual(44);

    await fireEvent.press(screen.getByTestId('sidebar-chevron'));
    const round = flatten(screen.getByTestId('sidebar-item-customers').props.style);
    expect(round.width).toBeGreaterThanOrEqual(44);
    expect(round.height).toBeGreaterThanOrEqual(44);
  });

  it('shows the user and role in the footer, and logs out after confirmation', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(204));
    await renderShell();

    expect(screen.getByTestId('sidebar-user')).toHaveTextContent(/Mia Manager/);
    expect(screen.getByTestId('sidebar-role')).toHaveTextContent(/Manager$/);

    await fireEvent.press(screen.getByTestId('sidebar-logout'));
    expect(screen.getByTestId('logout-dialog')).toHaveTextContent(/email and password/);
    await fireEvent.press(screen.getByTestId('logout-dialog-confirm'));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.50:8000/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(useSessionStore.getState().status).toBe('signedOut');
  });
});
