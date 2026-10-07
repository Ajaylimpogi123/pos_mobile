/**
 * Test-only helpers for the menu admin: contract-shaped fixtures, a
 * URL-routing fetch mock, and a render wrapper with a fresh QueryClient.
 * Never import from app code.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { AdminProduct, AuthUser, Category, CursorPage } from '@/services/types';

import { cashierUser, mockResponse } from './index';

/**
 * A manager, per the contract's roles table (all permissions except `branch.all`;
 * Printing, Phase 4, adds `settings.manage`; Offline Sales, Phase 5, adds `order.review`).
 */
export const managerUser: AuthUser = {
  ...cashierUser,
  id: 2,
  name: 'Mia Manager',
  email: 'manager@pos.test',
  role: { id: 2, slug: 'manager', name: 'Manager', max_discount_percent: 100, is_admin: true },
  permissions: [
    'discount.apply',
    'discount.override',
    'inventory.adjust',
    'order.review',
    'product.manage',
    // Ingredients, Recipes & Purchasing §E: the Manager's purchase slugs (not `purchase.approve_own`).
    'purchase.approve',
    'purchase.receive',
    'purchase.request',
    'report.view',
    'report.zread',
    'sale.create',
    'sale.refund',
    'sale.void',
    'settings.manage',
    'shift.close',
    'shift.open',
    'supplier.manage',
    'user.manage',
  ],
};

/** `Category` exactly as the contract example. */
export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 2,
    name: 'Breakfast',
    description: 'Served until 11 AM',
    sort_order: 10,
    is_active: true,
    products_count: 3,
    image_url: 'http://192.168.1.7:8000/storage/categories/2/9f1c2a.webp',
    image_path: 'categories/2/9f1c2a.webp',
    created_at: '2026-09-24T01:00:00Z',
    updated_at: '2026-09-24T01:00:00Z',
    ...overrides,
  };
}

/**
 * Admin `Product` exactly as the contract example (with `cost_cents`, and
 * `stock_qty` null: it doesn't track stock). §J: `stock_mode` follows
 * `track_stock` unless given, and `track_stock` is `stock_mode == own`.
 */
export function makeProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  const product = {
    id: 7,
    category: { id: 2, name: 'Breakfast' },
    sku: 'BRK-001',
    name: 'Egg with Rice',
    description: 'Two fried eggs, garlic rice',
    price_cents: 5000,
    cost_cents: 2200,
    stock_qty: null,
    is_vatable: true,
    is_available: true,
    track_stock: false,
    sort_order: 0,
    image_url: null,
    image_path: null,
    created_at: '2026-09-24T01:00:00Z',
    updated_at: '2026-09-24T01:00:00Z',
    ...overrides,
  };
  const stockMode = overrides.stock_mode ?? (product.track_stock ? 'own' : 'none');
  return { ...product, stock_mode: stockMode, track_stock: stockMode === 'own' };
}

/** The cursor pagination envelope from Global Conventions. */
export function page<T>(data: T[], nextCursor: string | null = null, path = '/api/v1/admin/products'): CursorPage<T> {
  return {
    data,
    links: { first: null, last: null, prev: null, next: nextCursor ? `http://192.168.1.50:8000${path}?cursor=${nextCursor}` : null },
    meta: { path: `http://192.168.1.50:8000${path}`, per_page: 25, next_cursor: nextCursor, prev_cursor: null },
  };
}

export type FetchCall = { method: string; path: string; query: URLSearchParams; init: RequestInit };

type Reply = Response | Promise<Response>;
export type Route = {
  method: string;
  /** Exact path (no origin, no query), or a pattern. */
  path: string | RegExp;
  reply: (call: FetchCall) => Reply;
};

/**
 * Installs a global fetch mock that answers by method + path. Unmatched
 * requests get a 404 so a test never hangs. `calls` records every request
 * in order, which lets tests assert request order and bodies.
 */
export function routeFetch(routes: Route[]) {
  const calls: FetchCall[] = [];
  const fetchMock = jest.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const call: FetchCall = { method: init.method ?? 'GET', path: url.pathname, query: url.searchParams, init };
    calls.push(call);
    const route = routes.find(
      (candidate) =>
        candidate.method === call.method &&
        (typeof candidate.path === 'string' ? candidate.path === call.path : candidate.path.test(call.path)),
    );
    if (!route) return mockResponse(404, { message: 'Resource not found.' });
    return route.reply(call);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

/** A promise you resolve later (e.g. to hold a request in flight). */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

/** Renders inside a fresh QueryClientProvider and returns the client too. */
export async function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient();
  const result = await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...result, client };
}

/** JSON body of a recorded request. */
export function jsonBody(call: FetchCall): unknown {
  return JSON.parse(String(call.init.body));
}
