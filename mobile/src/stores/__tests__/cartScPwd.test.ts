/**
 * The cart's SC/PWD (docs/api-contract.md → Senior Citizen / PWD Discount →
 * Device rules → Cart and checkout): no double discount, the mode switch,
 * the sheet's draft rules (ID numbers, diners ≥ persons, ticked lines), and
 * the request it builds.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useScPwdEditor } from '@/hooks/sell/useScPwdEditor';
import { buildOrderRequest, priceCart } from '@/sale/order';
import { classifyOrderError } from '@/sale/orderErrors';
import {
  describeConflicts,
  resolveScPwdDraft,
  scPwdConflicts,
  TICK_ITEMS_MESSAGE,
  type ScPwdDraft,
} from '@/sale/scPwd';
import { ApiValidationError } from '@/services/api';
import type { ScPwdRequest } from '@/services/types';
import { resetCart, useCartStore } from '@/stores/cart';
import { cartProduct, HOT_DOG, ICED_TEA } from '@/test-utils/sale';

const MEAL = cartProduct({ id: 21, name: 'Meal', price_cents: 25000 });
const TEA = cartProduct({ id: 22, name: 'Iced Tea', price_cents: 4500 });
const MEAL_2 = cartProduct({ id: 23, name: 'Meal B', price_cents: 25000 });

const SENIOR: ScPwdRequest = {
  mode: 'items',
  persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }],
  diners: null,
  vat_exempt: true,
};

const cart = () => useCartStore.getState();

/** Example D's cart: two meals and an iced tea. */
function fillExampleD() {
  cart().addProduct(MEAL);
  cart().addProduct(TEA);
  cart().addProduct(MEAL_2);
  return cart().lines.map((line) => line.key);
}

beforeEach(() => {
  resetCart();
});

describe('the cart store', () => {
  it('applies SC/PWD in items mode: the marked lines and the sale, priced as example D', () => {
    const [meal, tea] = fillExampleD();
    cart().applyScPwd(SENIOR, [meal, tea]);
    expect(cart().scPwd).toEqual(SENIOR);
    expect(cart().lines.map((line) => line.scPwd)).toEqual([true, true, false]);
    expect(priceCart(cart().lines, cart().orderDiscount, cart().scPwd).total_cents).toBe(46071);
  });

  it('applying over conflicting discounts removes them: the order discount and the marked lines\' discounts only', () => {
    const [meal, , other] = fillExampleD();
    cart().updateLine(meal, { qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: null });
    cart().updateLine(other, { qty: 1, discount: { type: 'manual', kind: 'amount', value: 500 }, notes: null });
    cart().setOrderDiscount({ type: 'promo', kind: 'amount', value: 1000 });

    cart().applyScPwd(SENIOR, [meal]);
    expect(cart().orderDiscount).toBeNull();
    expect(cart().lines[0].discount).toBeNull();
    // An unmarked line keeps its discount in items mode.
    expect(cart().lines[2].discount).toEqual({ type: 'manual', kind: 'amount', value: 500 });
  });

  it('while SC/PWD is set: no order discount; no line discount on a marked line (any line of a shared meal)', () => {
    const [meal, tea] = fillExampleD();
    cart().applyScPwd(SENIOR, [meal]);
    cart().setOrderDiscount({ type: 'promo', kind: 'amount', value: 1000 });
    expect(cart().orderDiscount).toBeNull();
    cart().updateLine(meal, { qty: 2, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: 'x' });
    expect(cart().lines[0]).toMatchObject({ qty: 2, discount: null, notes: 'x' });
    cart().updateLine(tea, { qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: null });
    expect(cart().lines[1].discount).not.toBeNull();

    cart().applyScPwd({ ...SENIOR, mode: 'headcount', diners: 4 }, []);
    expect(cart().lines[1].discount).toBeNull();
    cart().updateLine(tea, { qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: null });
    expect(cart().lines[1].discount).toBeNull();
  });

  it('the mode switch: headcount drops every line mark and keeps the diners; back to items keeps diners null', () => {
    const [meal, tea] = fillExampleD();
    cart().applyScPwd(SENIOR, [meal, tea]);
    cart().applyScPwd({ ...SENIOR, mode: 'headcount', diners: 4 }, [meal]);
    expect(cart().lines.every((line) => !line.scPwd)).toBe(true);
    expect(cart().scPwd).toMatchObject({ mode: 'headcount', diners: 4 });
    cart().applyScPwd({ ...SENIOR, diners: 4 }, [tea]);
    expect(cart().scPwd).toMatchObject({ mode: 'items', diners: null });
    expect(cart().lines.map((line) => line.scPwd)).toEqual([false, true, false]);
  });

  it('removing SC/PWD clears the marks; removing every line drops it; clearing resets it', () => {
    const [meal] = fillExampleD();
    cart().applyScPwd(SENIOR, [meal]);
    cart().removeScPwd();
    expect(cart().scPwd).toBeNull();
    expect(cart().lines.every((line) => !line.scPwd)).toBe(true);

    cart().applyScPwd(SENIOR, [meal]);
    for (const line of [...cart().lines]) cart().removeLine(line.key);
    expect(cart().scPwd).toBeNull();

    fillExampleD();
    cart().applyScPwd(SENIOR, [cart().lines[0].key]);
    cart().clear();
    expect(cart().scPwd).toBeNull();
  });

  it('a tile tap never tops up a marked line (as agreed in Q-023): it starts a new, unmarked one', () => {
    const [meal] = fillExampleD();
    cart().applyScPwd(SENIOR, [meal]);
    expect(cart().addProduct(MEAL)).toBe('added');
    expect(cart().lines).toHaveLength(4);
    expect(cart().lines[3]).toMatchObject({ qty: 1, scPwd: false });
  });

  it('nothing changes while a sale attempt is unconfirmed', () => {
    const [meal] = fillExampleD();
    cart().setAwaitingConfirmation(true);
    cart().applyScPwd(SENIOR, [meal]);
    expect(cart().scPwd).toBeNull();
  });

  it('the server\'s sc_pwd 422s are kept by field until the next attempt', () => {
    fillExampleD();
    cart().showServerErrors({ lines: {}, orderDiscount: null, customer: null, cart: null, scPwd: { 'persons.0.id_no': 'The id no format is invalid.' } });
    expect(cart().scPwdErrors).toEqual({ 'persons.0.id_no': 'The id no format is invalid.' });
    cart().clearServerErrors();
    expect(cart().scPwdErrors).toEqual({});
  });
});

describe('the request', () => {
  it('items mode: sc_pwd with diners null, and items[].sc_pwd on the marked lines', () => {
    const [meal, tea] = fillExampleD();
    cart().applyScPwd(SENIOR, [meal, tea]);
    const body = buildOrderRequest({
      ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W',
      lines: cart().lines,
      orderDiscount: null,
      customer: null,
      tableNo: null,
      payments: [],
      clientTotalCents: 46071,
      authorization: null,
      shiftUlid: '01K6S0A1B2C3D4E5F6G7H8J9KM',
      scPwd: cart().scPwd,
    });
    expect(body.sc_pwd).toEqual({ mode: 'items', persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }], diners: null, vat_exempt: true });
    expect(body.items.map((entry) => entry.sc_pwd)).toEqual([true, true, false]);
    expect(body.discount_authorization).toBeNull();
  });

  it('headcount mode: every items[].sc_pwd is false; no SC/PWD: sc_pwd null', () => {
    fillExampleD();
    cart().applyScPwd({ ...SENIOR, mode: 'headcount', diners: 4 }, []);
    const input = {
      ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W',
      lines: cart().lines,
      orderDiscount: null,
      customer: null,
      tableNo: null,
      payments: [],
      clientTotalCents: 0,
      authorization: null,
      shiftUlid: '01K6S0A1B2C3D4E5F6G7H8J9KM',
    };
    const body = buildOrderRequest({ ...input, scPwd: cart().scPwd });
    expect(body.sc_pwd).toMatchObject({ mode: 'headcount', diners: 4 });
    expect(body.items.every((entry) => entry.sc_pwd === false)).toBe(true);
    expect(buildOrderRequest({ ...input, scPwd: null }).sc_pwd).toBeNull();
  });

  it('the server\'s sc_pwd 422s go back to the cart, by field; items.{i}.sc_pwd to its line', () => {
    const failure = classifyOrderError(
      new ApiValidationError('The given data was invalid.', {
        'sc_pwd.persons.1.id_no': ['The sc pwd.persons.1.id_no field has a duplicate value.'],
        'sc_pwd.diners': ['The sc pwd.diners field must be at least 2.'],
        'items.0.discount': ["SC/PWD can't be combined with another discount."],
        items: [TICK_ITEMS_MESSAGE],
      }),
    );
    expect(failure.kind).toBe('cart');
    if (failure.kind !== 'cart') return;
    expect(failure.errors.scPwd).toEqual({
      'persons.1.id_no': 'The sc pwd.persons.1.id_no field has a duplicate value.',
      diners: 'The sc pwd.diners field must be at least 2.',
    });
    expect(failure.errors.lines[0]).toBe("SC/PWD can't be combined with another discount.");
    expect(failure.errors.cart).toBe(TICK_ITEMS_MESSAGE);
  });
});

describe('conflicts and the sheet draft', () => {
  const lines = [
    { key: 'a', discount: { type: 'promo' as const, kind: 'percent' as const, value: 1000 } },
    { key: 'b', discount: null },
    { key: 'c', discount: { type: 'manual' as const, kind: 'amount' as const, value: 100 } },
  ];

  it('items: the order discount and the marked lines\' discounts; headcount: every line discount', () => {
    expect(scPwdConflicts(lines, null, 'items', new Set(['a', 'b']))).toEqual({ orderDiscount: false, lineKeys: ['a'] });
    const all = scPwdConflicts(lines, { type: 'promo', kind: 'amount', value: 100 }, 'headcount', new Set());
    expect(all).toEqual({ orderDiscount: true, lineKeys: ['a', 'c'] });
    expect(describeConflicts(all)).toBe("SC/PWD can't be combined with another discount, so the order discount and 2 line discounts are removed.");
  });

  function draft(overrides: Partial<ScPwdDraft> = {}): ScPwdDraft {
    return {
      mode: 'items',
      persons: [{ key: 'p1', type: 'senior_citizen', idNo: ' OSCA-12345 ' }],
      diners: 2,
      vatExempt: false,
      markedKeys: ['a'],
      ...overrides,
    };
  }

  it('builds the request: trimmed ID numbers, diners null in items mode, VAT exempt as ticked', () => {
    expect(resolveScPwdDraft(draft(), ['a', 'b'])).toEqual({
      scPwd: { mode: 'items', persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }], diners: null, vat_exempt: false },
      markedKeys: ['a'],
      errors: null,
    });
    expect(resolveScPwdDraft(draft({ mode: 'headcount', diners: 3 }), ['a']).scPwd).toMatchObject({ diners: 3 });
  });

  it('ID numbers: required, the contract regex, max 30, distinct', () => {
    const result = resolveScPwdDraft(
      draft({
        persons: [
          { key: 'p1', type: 'senior_citizen', idNo: '' },
          { key: 'p2', type: 'pwd', idNo: 'PWD#1' },
          { key: 'p3', type: 'pwd', idNo: 'X'.repeat(31) },
          { key: 'p4', type: 'pwd', idNo: 'RR-1/2 A' },
          { key: 'p5', type: 'senior_citizen', idNo: 'RR-1/2 A' },
        ],
      }),
      ['a'],
    );
    expect(result.errors?.persons).toEqual({
      p1: 'Enter the OSCA or PWD ID number.',
      p2: 'Use only letters, numbers, spaces, dashes and slashes.',
      p3: 'Use 30 characters or fewer.',
      p5: 'This ID number is already on this sale.',
    });
  });

  it('items mode needs a ticked line of the cart; headcount needs diners from the persons count', () => {
    expect(resolveScPwdDraft(draft({ markedKeys: ['gone'] }), ['a']).errors?.lines).toBe(TICK_ITEMS_MESSAGE);
    const persons = [
      { key: 'p1', type: 'senior_citizen' as const, idNo: 'A1' },
      { key: 'p2', type: 'pwd' as const, idNo: 'B2' },
    ];
    expect(resolveScPwdDraft(draft({ mode: 'headcount', persons, diners: 1 }), ['a']).errors?.diners).toBe(
      'At least 2 diners: one for each SC/PWD.',
    );
    expect(resolveScPwdDraft(draft({ mode: 'headcount', persons, diners: 101 }), ['a']).errors?.diners).toBe('Up to 100 diners.');
  });
});

describe('useScPwdEditor', () => {
  it('a new SC/PWD starts with one senior citizen, Their items, VAT exempt unticked', async () => {
    cart().addProduct(HOT_DOG);
    const { result } = await renderHook(() => useScPwdEditor());
    await act(async () => result.current.open());
    expect(result.current.draft).toMatchObject({ mode: 'items', vatExempt: false, markedKeys: [] });
    expect(result.current.draft?.persons).toHaveLength(1);
  });

  it('diners never go below the persons count; adding a person raises them', async () => {
    cart().addProduct(HOT_DOG);
    const { result } = await renderHook(() => useScPwdEditor());
    await act(async () => result.current.open());
    await act(async () => result.current.setMode('headcount'));
    await act(async () => result.current.setDiners(0));
    expect(result.current.draft?.diners).toBe(1);
    await act(async () => result.current.addPerson());
    await act(async () => result.current.addPerson());
    expect(result.current.draft?.diners).toBe(3);
    await act(async () => result.current.setDiners(2));
    expect(result.current.draft?.diners).toBe(3);
  });

  it('asks before removing conflicting discounts, then applies; with none it applies at once', async () => {
    cart().addProduct(HOT_DOG);
    cart().addProduct(ICED_TEA);
    const [hotDog, tea] = cart().lines.map((line) => line.key);
    cart().setOrderDiscount({ type: 'promo', kind: 'amount', value: 500 });
    const { result } = await renderHook(() => useScPwdEditor());
    await act(async () => result.current.open());
    const person = result.current.draft?.persons[0].key ?? '';
    await act(async () => result.current.setPersonId(person, 'OSCA-1'));
    await act(async () => result.current.toggleLine(hotDog));
    await act(async () => result.current.apply());
    expect(result.current.pending?.conflicts).toEqual({ orderDiscount: true, lineKeys: [] });
    expect(cart().scPwd).toBeNull();

    await act(async () => result.current.cancelRemoval());
    expect(cart().orderDiscount).not.toBeNull();
    await act(async () => result.current.apply());
    await act(async () => result.current.confirmRemoval());
    expect(cart().orderDiscount).toBeNull();
    expect(cart().scPwd).toMatchObject({ mode: 'items', vat_exempt: false });
    expect(result.current.draft).toBeNull();

    // Editing it again: the draft starts from the cart; ticking the tea too applies at once.
    await act(async () => result.current.open());
    expect(result.current.draft?.markedKeys).toEqual([hotDog]);
    await act(async () => result.current.toggleLine(tea));
    await act(async () => result.current.apply());
    expect(cart().lines.map((line) => line.scPwd)).toEqual([true, true]);
  });

  it('shows the draft\'s problems instead of applying', async () => {
    cart().addProduct(HOT_DOG);
    const { result } = await renderHook(() => useScPwdEditor());
    await act(async () => result.current.open());
    await act(async () => result.current.apply());
    expect(result.current.errors?.lines).toBe(TICK_ITEMS_MESSAGE);
    expect(Object.values(result.current.errors?.persons ?? {})).toEqual(['Enter the OSCA or PWD ID number.']);
    expect(cart().scPwd).toBeNull();
  });
});
