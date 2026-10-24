/**
 * The header (MASTER §2.1 / §2.2 / §6): one row only (56 dp on phones, 48 on
 * tablets), the sync badge on every app-shell screen, no eyebrow line, toolbar content below the bar, the ☰ menu
 * only in drawer mode, and the Sell status chips inside the bar (labelled on
 * tablets and in landscape, icon-only on phones in portrait).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useNetworkState } from 'expo-network';
import type { ReactElement } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ListHeader } from '@/components/shared/ListHeader';
import { SellHeader } from '@/components/sell/SellHeader';
import { ShellContext, type ShellContextValue } from '@/components/shell/ShellContext';
import { TopBar } from '@/components/ui/TopBar';
import { hitTarget, sizes } from '@/constants/theme';
import type { SellSyncState } from '@/hooks/sell/useSellScreen';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { renderWithQuery } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { makeLocalShift } from '@/test-utils/shifts';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const networkState = useNetworkState as jest.Mock;

function sync(overrides: Partial<SellSyncState> = {}): SellSyncState {
  return {
    status: 'synced',
    error: null,
    syncedLabel: 'Synced just now',
    syncing: false,
    online: true,
    serverReachable: true,
    pending: 0,
    needsAttention: 0,
    outboxSyncing: false,
    ...overrides,
  };
}

function shell(navigation: ShellContextValue['navigation']): ShellContextValue {
  return { navigation, openNavigation: jest.fn(), sidebarExpanded: false, sidebarWidth: 0 };
}

function inShell(ui: ReactElement, navigation: ShellContextValue['navigation']) {
  return renderWithQuery(<ShellContext.Provider value={shell(navigation)}>{ui}</ShellContext.Provider>);
}

function renderSellHeader(navigation: ShellContextValue['navigation']) {
  return inShell(
    <SellHeader sync={sync()} onSyncNow={jest.fn()} shift={makeLocalShift()} onOpenShiftMenu={jest.fn()} />,
    navigation,
  );
}

function barHeight(testID: string): number {
  return Number(StyleSheet.flatten(screen.getByTestId(testID).props.style).minHeight);
}

beforeEach(async () => {
  await freshTestDatabase();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
});

afterEach(() => {
  resetWindowSize();
});

describe('TopBar', () => {
  it('is one compact row: 48 on tablets, 56 on phones, and follows rotation', async () => {
    await renderWithQuery(<TopBar title="Orders" testID="bar" />);
    expect(barHeight('bar-bar')).toBe(sizes.topBar.tablet);

    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    expect(barHeight('bar-bar')).toBe(56);

    await act(async () => setWindowSize(REFERENCE_SIZES.phoneLandscapeSmall.width, REFERENCE_SIZES.phoneLandscapeSmall.height));
    expect(barHeight('bar-bar')).toBe(56);
  });

  it('keeps the title on one line and shows the subtitle in the same bar only where there is room', async () => {
    await renderWithQuery(<TopBar title="Orders" subtitle="Your sales" testID="bar" />);
    const bar = screen.getByTestId('bar-bar');
    expect(within(bar).getByTestId('bar-title').props.numberOfLines).toBe(1);
    expect(within(bar).getByTestId('bar-subtitle')).toHaveTextContent('Your sales');

    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    expect(screen.queryByTestId('bar-subtitle')).toBeNull();
    expect(screen.getByTestId('bar-title')).toHaveTextContent('Orders');
  });

  it('renders toolbar content below the bar, never inside it', async () => {
    await renderWithQuery(
      <TopBar title="Menu" testID="bar">
        <Text testID="tabs">Tabs</Text>
      </TopBar>,
    );
    expect(within(screen.getByTestId('bar-toolbar')).getByTestId('tabs')).toBeOnTheScreen();
    expect(within(screen.getByTestId('bar-bar')).queryByTestId('tabs')).toBeNull();
  });

  it('shows the sync state (dot + "Online · synced") inside the app shell, and opens the Sync queue for a cashier', async () => {
    useSyncStore.setState({ status: 'synced', lastServerTime: '2026-10-13T01:00:00Z' });
    await inShell(<TopBar title="Orders" testID="bar" />, 'persistent');
    const badge = within(screen.getByTestId('bar-bar')).getByTestId('header-sync-status');
    expect(badge).toHaveTextContent('Online · synced');
    await fireEvent.press(screen.getByTestId('header-sync-status-open'));
    expect(router.push).toHaveBeenCalledWith('/sync-queue');
  });

  it('says "Offline · n pending" while offline sales wait, and hides the badge outside the shell or when asked', async () => {
    useOfflineStore.setState({ pending: 3 });
    networkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    await inShell(<TopBar title="Orders" testID="bar" />, 'persistent');
    expect(screen.getByTestId('header-sync-status')).toHaveTextContent('Offline · 3 pending');

    await renderWithQuery(<TopBar title="Orders" testID="plain" />);
    expect(screen.queryByTestId('header-sync-status')).toBeNull();
    await inShell(<TopBar title="Sell" sync={false} testID="own" />, 'persistent');
    expect(screen.queryByTestId('header-sync-status')).toBeNull();
    networkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
    useOfflineStore.setState({ pending: 0 });
  });
});

describe('Sell top bar', () => {
  it('tablet landscape: shift, sync and printer chips with labels sit in the bar; no second row, no eyebrow', async () => {
    await renderSellHeader('persistent');

    const bar = screen.getByTestId('sell-header-bar');
    expect(barHeight('sell-header-bar')).toBe(sizes.topBar.tablet);
    expect(within(bar).getByTestId('shift-pill')).toBeOnTheScreen();
    expect(within(bar).getByTestId('sync-status')).toHaveTextContent(/Synced just now$/);
    expect(within(bar).getByTestId('printer-status')).toHaveTextContent(/\S/);
    expect(within(bar).getByTestId('sell-sync-now')).toBeOnTheScreen();
    expect(screen.queryByTestId('sell-header-toolbar')).toBeNull();
    expect(screen.getByTestId('sell-header')).not.toHaveTextContent(/Menu on this device/);
    // The chips scroll sideways inside the bar rather than wrapping onto a second row.
    expect(within(bar).getByTestId('sell-status').props.horizontal).toBe(true);
    // Persistent sidebar: no ☰.
    expect(screen.queryByTestId('sell-open-navigation')).toBeNull();
  });

  it('phone portrait: icon-only chips that keep their accessibility labels and tap targets, and the ☰ button', async () => {
    setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    await renderSellHeader('drawer');

    const bar = screen.getByTestId('sell-header-bar');
    expect(barHeight('sell-header-bar')).toBe(56);
    expect(within(bar).getByTestId('sell-open-navigation')).toBeOnTheScreen();

    const status = within(bar).getByTestId('sync-status');
    expect(status).not.toHaveTextContent(/Synced/);
    expect(status.props.accessibilityLabel).toBe('Synced just now');
    expect(within(bar).getByTestId('sync-status-open').props.accessibilityLabel).toBe('Sync status: Synced just now');
    expect(within(bar).getByTestId('printer-status').props.accessibilityLabel).toMatch(/\S/);
    expect(within(bar).getByTestId('shift-pill').props.accessibilityLabel).toMatch(/^Shift since /);
    // A status chip plus its slop is at least the 44 minimum.
    const slop = within(bar).getByTestId('shift-pill').props.hitSlop;
    expect(sizes.statusChipHeight + slop.top + slop.bottom).toBeGreaterThanOrEqual(hitTarget.min);
    expect(screen.queryByTestId('sell-header-toolbar')).toBeNull();
  });

  it('phone landscape: the chips show their labels again', async () => {
    setWindowSize(REFERENCE_SIZES.phoneLandscape.width, REFERENCE_SIZES.phoneLandscape.height);
    await renderSellHeader('persistent');
    expect(within(screen.getByTestId('sell-header-bar')).getByTestId('sync-status')).toHaveTextContent(/Synced just now$/);
  });
});

describe('List top bar', () => {
  it('drawer mode: ☰ and back; persistent sidebar: back only; "+" stays in the bar', async () => {
    const onNew = jest.fn();
    await inShell(<ListHeader title="Staff" newLabel="New staff" onNew={onNew} testIDPrefix="staff" />, 'drawer');
    const bar = screen.getByTestId('staff-header-bar');
    expect(within(bar).getByTestId('staff-open-navigation')).toBeOnTheScreen();
    expect(within(bar).getByTestId('staff-back')).toBeOnTheScreen();
    expect(within(bar).getByTestId('staff-new').props.accessibilityLabel).toBe('New staff');

    await inShell(<ListHeader title="Staff" testIDPrefix="staff2" />, 'persistent');
    const persistentBar = screen.getByTestId('staff2-header-bar');
    expect(within(persistentBar).queryByTestId('staff2-open-navigation')).toBeNull();
    expect(within(persistentBar).getByTestId('staff2-back')).toBeOnTheScreen();
    expect(within(persistentBar).queryByTestId('staff2-new')).toBeNull();
  });

  it('band: the title, the branch and business date, and the green Add pill sit on the decorative band', async () => {
    const onNew = jest.fn();
    await inShell(
      <ListHeader title="Customers" band newTitle="Add customer" newLabel="New customer" onNew={onNew} testIDPrefix="customers" />,
      'persistent',
    );
    expect(screen.getByTestId('customers-band-title')).toHaveTextContent('Customers');
    expect(screen.getByTestId('customers-band-subtitle')).toHaveTextContent(new RegExp(`^${cashierUser.branch.name} · `));
    const gradient = screen.getByTestId('customers-band-gradient', { includeHiddenElements: true });
    expect(gradient.props.accessibilityElementsHidden).toBe(true);
    // The create action moves from the header onto the band.
    expect(within(screen.getByTestId('customers-header-bar')).queryByTestId('customers-new')).toBeNull();
    await fireEvent.press(within(screen.getByTestId('customers-band')).getByTestId('customers-new'));
    expect(onNew).toHaveBeenCalled();
  });
});
