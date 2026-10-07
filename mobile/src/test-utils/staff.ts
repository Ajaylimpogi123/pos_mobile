/**
 * Test-only fixtures for staff and customers, shaped exactly like the
 * contract examples (Feature: Staff & Customers, Phase 1b). Never import
 * from app code.
 */
import type { AuthUser, Customer, Role, StaffUser } from '@/services/types';

import { managerUser } from './catalog';
import { cashierUser } from './index';

/** `StaffUser` as the contract example (Carla Cashier). */
export function makeStaff(overrides: Partial<StaffUser> = {}): StaffUser {
  return {
    id: 3,
    name: 'Carla Cashier',
    email: 'cashier@pos.test',
    is_active: true,
    has_pin: false,
    can_manage: true,
    last_login_at: '2026-09-24T02:54:59Z',
    role: { id: 3, slug: 'cashier', name: 'Cashier' },
    created_at: '2026-09-24T01:55:04Z',
    updated_at: '2026-09-24T01:55:27Z',
    ...overrides,
  };
}

/** The signed-in manager's own staff record (id 2, as `managerUser`). */
export const managerStaff = makeStaff({
  id: 2,
  name: 'Mia Manager',
  email: 'manager@pos.test',
  has_pin: true,
  role: { id: 2, slug: 'manager', name: 'Manager' },
});

/** An owner: a manager can't manage them (`can_manage: false`). */
export const ownerStaff = makeStaff({
  id: 1,
  name: 'Olga Owner',
  email: 'owner@pos.test',
  has_pin: true,
  can_manage: false,
  last_login_at: null,
  role: { id: 1, slug: 'owner', name: 'Owner' },
});

/** `GET /api/v1/admin/roles` items as a manager sees them: Owner is not assignable. */
export const rolesForManager: Role[] = [
  {
    id: 1,
    slug: 'owner',
    name: 'Owner',
    is_admin: true,
    max_discount_percent: 100,
    permissions: ['branch.all', 'customer.manage', 'user.manage'],
    assignable: false,
  },
  {
    id: 2,
    slug: 'manager',
    name: 'Manager',
    is_admin: true,
    max_discount_percent: 100,
    permissions: ['customer.manage', 'discount.apply', 'user.manage'],
    assignable: true,
  },
  {
    id: 3,
    slug: 'cashier',
    name: 'Cashier',
    is_admin: false,
    max_discount_percent: 10,
    permissions: ['discount.apply', 'sale.create', 'shift.close', 'shift.open'],
    assignable: true,
  },
];

/** A manager after Phase 1b: also holds `customer.manage`. */
export const managerWithCustomers: AuthUser = {
  ...managerUser,
  permissions: [...managerUser.permissions, 'customer.manage'].sort(),
};

/** A signed-in user with no permissions at all (e.g. a custom read-only role). */
export const viewerUser: AuthUser = {
  ...cashierUser,
  id: 9,
  name: 'Vic Viewer',
  role: { id: 9, slug: 'viewer', name: 'Viewer', max_discount_percent: 0, is_admin: false },
  permissions: [],
};

/** `Customer` as the contract example (Maria Santos). */
export function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 12,
    first_name: 'Maria',
    last_name: 'Santos',
    full_name: 'Maria Santos',
    contact: '0917 123 4567',
    email: 'maria@example.com',
    notes: 'Prefers less rice',
    created_at: '2026-09-24T03:00:00Z',
    updated_at: '2026-09-24T03:00:00Z',
    ...overrides,
  };
}
