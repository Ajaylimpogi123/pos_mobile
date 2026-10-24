import {
  describeDiscount,
  discountNeedsApproval,
  discountToInputText,
  eligibleApprovers,
  formatPercentValue,
  parseDiscountInput,
  resolveDiscountDraft,
} from '@pos/core/sale/discountRules';
import type { PinUser } from '@/services/types';
import { cashierUser } from '@/test-utils';
import { managerUser } from '@/test-utils/catalog';

describe('discountNeedsApproval (contract → Discount rules)', () => {
  it('needs none without a discount', () => {
    expect(discountNeedsApproval({ regular_discount_cents: 0, subtotal_cents: 10000 }, cashierUser)).toBe(false);
  });

  it('compares discount × 100 with subtotal × the role limit, exactly', () => {
    // Cashier limit 10%: ₱10.00 off ₱100.00 is exactly 10% → no approval; 1 centavo more → approval.
    expect(discountNeedsApproval({ regular_discount_cents: 1000, subtotal_cents: 10000 }, cashierUser)).toBe(false);
    expect(discountNeedsApproval({ regular_discount_cents: 1001, subtotal_cents: 10000 }, cashierUser)).toBe(true);
    // Manager limit 100%.
    expect(discountNeedsApproval({ regular_discount_cents: 10000, subtotal_cents: 10000 }, managerUser)).toBe(false);
  });

  it('always needs approval without `discount.apply`', () => {
    const noApply = { ...cashierUser, permissions: ['sale.create'] };
    expect(discountNeedsApproval({ regular_discount_cents: 1, subtotal_cents: 10000 }, noApply)).toBe(true);
    expect(discountNeedsApproval({ regular_discount_cents: 1, subtotal_cents: 10000 }, null)).toBe(true);
  });
});

describe('eligibleApprovers', () => {
  const people: PinUser[] = [
    { id: 1, name: 'Olga Owner', role: { slug: 'owner', name: 'Owner' }, can_approve_discounts: true, max_discount_percent: 100, can_approve_voids: true, can_approve_refunds: true },
    { id: 2, name: 'Marco Manager', role: { slug: 'manager', name: 'Manager' }, can_approve_discounts: true, max_discount_percent: 20, can_approve_voids: true, can_approve_refunds: true },
    { id: 3, name: 'Carla Cashier', role: { slug: 'cashier', name: 'Cashier' }, can_approve_discounts: false, max_discount_percent: 10, can_approve_voids: false, can_approve_refunds: false },
  ];

  it('keeps people with discount.override whose limit covers the discount', () => {
    expect(eligibleApprovers(people, { regular_discount_cents: 2000, subtotal_cents: 10000 }).map((person) => person.id)).toEqual([1, 2]);
    expect(eligibleApprovers(people, { regular_discount_cents: 2001, subtotal_cents: 10000 }).map((person) => person.id)).toEqual([1]);
  });
});

describe('discount values', () => {
  it('parses a percentage to basis points without floats', () => {
    expect(parseDiscountInput('percent', '10')).toEqual({ value: 1000, error: null });
    expect(parseDiscountInput('percent', '12.5')).toEqual({ value: 1250, error: null });
    expect(parseDiscountInput('percent', '0.29%')).toEqual({ value: 29, error: null });
    expect(parseDiscountInput('percent', '100')).toEqual({ value: 10000, error: null });
    expect(parseDiscountInput('percent', '100.01').error).toMatch(/0\.01 to 100/);
    expect(parseDiscountInput('percent', '0').error).toMatch(/0\.01 to 100/);
    expect(parseDiscountInput('percent', '1.234').error).toMatch(/like 10 or 12\.5/);
    expect(parseDiscountInput('percent', '').error).toBe('Enter a percentage.');
  });

  it('parses an amount to centavos', () => {
    expect(parseDiscountInput('amount', '10')).toEqual({ value: 1000, error: null });
    expect(parseDiscountInput('amount', '₱1,250.50')).toEqual({ value: 125050, error: null });
    expect(parseDiscountInput('amount', '0').error).toMatch(/at least/);
    expect(parseDiscountInput('amount', '10000000.01').error).toMatch(/can't be more than/);
  });

  it('formats and round-trips values', () => {
    expect(formatPercentValue(1000)).toBe('10%');
    expect(formatPercentValue(1250)).toBe('12.5%');
    expect(formatPercentValue(1205)).toBe('12.05%');
    expect(describeDiscount({ type: 'promo', kind: 'percent', value: 1000 })).toBe('Promo · 10%');
    expect(describeDiscount({ type: 'employee', kind: 'amount', value: 1000 })).toBe('Employee · ₱10.00');
    expect(discountToInputText({ kind: 'percent', value: 1250 })).toBe('12.5');
    expect(discountToInputText({ kind: 'amount', value: 1005 })).toBe('10.05');
  });

  it('refuses an amount above its base with the server wording', () => {
    const draft = { enabled: true, type: 'manual' as const, kind: 'amount' as const, value: '81' };
    expect(resolveDiscountDraft(draft, 8000)).toEqual({ discount: null, error: "The discount can't be more than ₱80.00." });
    expect(resolveDiscountDraft({ ...draft, value: '80' }, 8000)).toEqual({
      discount: { type: 'manual', kind: 'amount', value: 8000 },
      error: null,
    });
    expect(resolveDiscountDraft({ ...draft, enabled: false }, 8000)).toEqual({ discount: null, error: null });
  });
});
