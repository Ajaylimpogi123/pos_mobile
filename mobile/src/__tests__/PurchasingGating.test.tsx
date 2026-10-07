/**
 * Ingredients, Recipes & Purchasing: permission gating (§E: modules and
 * actions per slug, as UI hints) and the online-only screens (§L: offline
 * shows `Purchasing needs a connection.`, `Ingredients need a connection.`,
 * `Inventory needs a connection.`), plus the new dashboard insight targets.
 */
import { screen } from '@testing-library/react-native';
import { useNetworkState } from 'expo-network';
import { useLocalSearchParams } from 'expo-router';

import IngredientsIndexRoute from '@/app/(app)/(admin)/ingredients/index';
import IngredientStockIndexRoute from '@/app/(app)/(admin)/inventory/ingredients/index';
import PurchaseOrdersIndexRoute from '@/app/(app)/(admin)/purchasing/orders/index';
import ReceivingIndexRoute from '@/app/(app)/(admin)/purchasing/receiving/index';
import PurchaseRequestRoute from '@/app/(app)/(admin)/purchasing/requests/[ulid]/index';
import PurchaseRequestsIndexRoute from '@/app/(app)/(admin)/purchasing/requests/index';
import NewPurchaseRequestRoute from '@/app/(app)/(admin)/purchasing/requests/new';
import SuppliersIndexRoute from '@/app/(app)/(admin)/purchasing/suppliers/index';
import { activeModuleKey, visibleModuleGroups } from '@/constants/modules';
import { insightTarget } from '@/hooks/dashboard/dashboardModel';
import type { AuthUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { cashierUser, secureStoreMock } from '@/test-utils';
import { managerUser, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { ownerUser, PR_ULID, requesterCashier } from '@/test-utils/purchasing';

const FUTURE = '2099-09-25T01:30:00Z';
const networkState = useNetworkState as jest.Mock;

function modulesOf(user: AuthUser): string[] {
  return visibleModuleGroups(user).flatMap((group) => group.modules.map((module) => module.key));
}

function groupOf(user: AuthUser, key: string): string[] {
  return visibleModuleGroups(user).find((group) => group.key === key)?.modules.map((module) => module.key) ?? [];
}

function withOnly(...permissions: string[]): AuthUser {
  return { ...cashierUser, permissions };
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
});

afterEach(() => {
  networkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
});

describe('modules per slug', () => {
  it('a manager sees the Purchasing group and Ingredients in Catalogue', () => {
    expect(groupOf(managerUser, 'purchasing')).toEqual(['purchase_requests', 'purchase_orders', 'receiving', 'suppliers']);
    expect(groupOf(managerUser, 'catalogue')).toEqual(['menu', 'ingredients', 'inventory']);
    expect(groupOf(ownerUser, 'purchasing')).toHaveLength(4);
  });

  it('a cashier sees none of it', () => {
    expect(modulesOf(cashierUser)).not.toEqual(expect.arrayContaining(['purchase_requests']));
    expect(visibleModuleGroups(cashierUser).map((group) => group.key)).not.toContain('purchasing');
    expect(modulesOf(cashierUser)).not.toContain('ingredients');
  });

  it('purchase.request alone: requests, orders and suppliers (read), no receiving', () => {
    expect(groupOf(requesterCashier, 'purchasing')).toEqual(['purchase_requests', 'purchase_orders', 'suppliers']);
    expect(modulesOf(requesterCashier)).not.toContain('reports');
  });

  it('report.view alone reads requests and orders, not suppliers or receiving', () => {
    expect(groupOf(withOnly('report.view'), 'purchasing')).toEqual(['purchase_requests', 'purchase_orders']);
  });

  it('purchase.receive alone gets Receiving', () => {
    expect(groupOf(withOnly('purchase.receive'), 'purchasing')).toEqual(['purchase_requests', 'purchase_orders', 'receiving', 'suppliers']);
  });

  it('purchase.approve alone opens Reports (its Purchasing view)', () => {
    expect(modulesOf(withOnly('purchase.approve'))).toContain('reports');
  });

  it('marks the active module from the path', () => {
    expect(activeModuleKey('/purchasing/requests/01K6PR0000000000000000000A')).toBe('purchase_requests');
    expect(activeModuleKey('/purchasing/receiving/X')).toBe('receiving');
    expect(activeModuleKey('/purchasing/suppliers/4')).toBe('suppliers');
    expect(activeModuleKey('/ingredients/5')).toBe('ingredients');
    expect(activeModuleKey('/inventory/ingredients/5')).toBe('inventory');
  });
});

describe('dashboard insight targets', () => {
  it('ingredient alerts open Inventory → Ingredients (Low & out)', () => {
    expect(insightTarget('inventory.ingredients.alerts', managerUser)?.route).toEqual({ pathname: '/inventory/ingredients', params: { status: 'alerts' } });
    expect(insightTarget('inventory.ingredients.alerts', cashierUser)).toBeNull();
  });

  it('purchasing insights open their lists, for the right slug (Q-029 keys)', () => {
    expect(insightTarget('purchasing.requests.pending', managerUser)?.route).toEqual({ pathname: '/purchasing/requests', params: { view: 'decision' } });
    expect(insightTarget('purchasing.orders.pending', managerUser)?.route).toEqual({ pathname: '/purchasing/orders', params: { status: 'pending_approval' } });
    expect(insightTarget('purchasing.orders.to_receive', managerUser)?.route).toBe('/purchasing/receiving');
    expect(insightTarget('purchasing.requests.pending', requesterCashier)).toBeNull();
    expect(insightTarget('purchasing.orders.to_receive', withOnly('purchase.approve'))).toBeNull();
  });
});

describe('offline', () => {
  beforeEach(() => {
    networkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
  });

  it.each([
    ['Purchase requests', PurchaseRequestsIndexRoute, 'prs-offline', 'Purchasing needs a connection.'],
    ['Purchase orders', PurchaseOrdersIndexRoute, 'pos-offline', 'Purchasing needs a connection.'],
    ['Receiving', ReceivingIndexRoute, 'pos-offline', 'Purchasing needs a connection.'],
    ['Suppliers', SuppliersIndexRoute, 'suppliers-offline', 'Purchasing needs a connection.'],
    ['Ingredients', IngredientsIndexRoute, 'ingredients-offline', 'Ingredients need a connection.'],
    ['Inventory → Ingredients', IngredientStockIndexRoute, 'ingredient-stock-offline', 'Inventory needs a connection.'],
  ])('%s says so and sends nothing', async (_label, Route, testID, message) => {
    const { calls } = routeFetch([]);
    await renderWithQuery(<Route />);
    expect(screen.getByTestId(testID)).toHaveTextContent(new RegExp(message.replace('.', '\\.')));
    expect(calls.filter((call) => !call.path.startsWith('/api/v1/units'))).toHaveLength(0);
  });

  it('a purchase request detail says Purchasing needs a connection', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: PR_ULID });
    routeFetch([]);
    await renderWithQuery(<PurchaseRequestRoute />);
    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Purchasing needs a connection\./);
  });

  it('the new request form warns and disables Save', async () => {
    routeFetch([]);
    await renderWithQuery(<NewPurchaseRequestRoute />);
    expect(screen.getByTestId('pr-form-offline')).toHaveTextContent(/Purchasing needs a connection\./);
    expect(screen.getByTestId('pr-save')).toBeDisabled();
  });
});
