/**
 * Test-only dashboard fixtures, shaped exactly like the contract (Feature:
 * Dashboard, Phase 1c). Never import from app code.
 */
import type { Dashboard, DashboardDayCount } from '@/services/types';

const DAYS = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];

function days(counts: number[]): DashboardDayCount[] {
  return DAYS.map((date, index) => ({ date, count: counts[index] }));
}

/** What a manager sees: every section except `sales` (always null in Phase 1c). */
export function managerDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    generated_at: '2026-09-24T07:00:00Z',
    business_date: '2026-09-24',
    catalog: {
      products_total: 5,
      products_available: 4,
      products_unavailable: 1,
      products_without_image: 5,
      products_tracking_stock: 2,
      products_without_cost: 1,
      categories_total: 3,
      categories_active: 2,
      categories_empty: 1,
      average_margin_bps: 5500,
      low_margin_threshold_bps: 3000,
      low_margin_products: [
        { id: 9, name: 'Iced Tea', category_name: 'Drinks', price_cents: 3500, cost_cents: 2800, margin_bps: 2000 },
      ],
      by_category: [
        { category_id: 1, name: 'Breakfast', is_active: true, products_total: 3, products_available: 2, average_margin_bps: 5500 },
        { category_id: 2, name: 'Drinks', is_active: true, products_total: 2, products_available: 2, average_margin_bps: 2000 },
        { category_id: 3, name: 'Desserts', is_active: false, products_total: 0, products_available: 0, average_margin_bps: null },
      ],
    },
    staff: {
      total: 5,
      active: 4,
      inactive: 1,
      without_pin: 1,
      never_logged_in: 2,
      by_role: [
        { role_id: 1, slug: 'owner', name: 'Owner', count: 1 },
        { role_id: 2, slug: 'manager', name: 'Manager', count: 4 },
        { role_id: 3, slug: 'cashier', name: 'Cashier', count: 0 },
      ],
      recent_logins: [
        { user_id: 3, name: 'Carla Cashier', role_name: 'Cashier', last_login_at: '2026-09-24T06:46:05Z' },
      ],
    },
    customers: { total: 3, new_last_7_days: 2, new_last_30_days: 3 },
    activity: {
      logins_by_day: days([0, 1, 0, 2, 3, 1, 6]),
      changes_by_day: days([0, 0, 4, 0, 2, 1, 14]),
      recent_changes: [
        {
          id: 88,
          action: 'product.updated',
          summary: 'Updated product "Egg with Rice"',
          actor_name: 'Marco Manager',
          created_at: '2026-09-24T06:40:00Z',
        },
      ],
    },
    sales: null,
    insights: [
      {
        key: 'products_without_cost',
        severity: 'warning',
        title: '1 product has no cost',
        message: 'Add a cost so margins can be worked out.',
        count: 1,
        action: 'menu.products',
      },
      {
        key: 'staff_without_pin',
        severity: 'warning',
        title: '1 active staff member has no PIN',
        message: 'PINs make switching users at the counter quick.',
        count: 1,
        action: 'staff',
      },
      {
        key: 'categories_empty',
        severity: 'info',
        title: '1 category is empty',
        message: 'Add products to it or hide it.',
        count: 1,
        action: 'menu.categories',
      },
    ],
    ...overrides,
  };
}

/** What a cashier sees: only `customers`; insights come from visible sections only (none here). */
export function cashierDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    generated_at: '2026-09-24T07:00:00Z',
    business_date: '2026-09-24',
    catalog: null,
    staff: null,
    customers: { total: 3, new_last_7_days: 3, new_last_30_days: 3 },
    activity: null,
    sales: null,
    insights: [],
    ...overrides,
  };
}
