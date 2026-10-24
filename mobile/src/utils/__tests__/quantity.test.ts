/**
 * Exact quantities (docs/api-contract.md → Ingredients, Recipes & Purchasing
 * §A): `base_qty = round_half_up(qty × factor, 3)` with BigInt, worked example
 * G to the digit, the valid units per item, and the display helpers.
 */
import { basePreview } from '@/components/units/QtyUnitField';
import { projectLine, statusForReceived } from '@/hooks/purchasing/useReceiving';
import { makeIngredient, makeMilk, makePoLine, UNIT_CATALOG } from '@/test-utils/purchasing';
import {
  costForBaseUnits,
  divRoundHalfUp,
  formatBaseQty,
  formatQty,
  friendlyQty,
  lineTotalCents,
  parseFactorInput,
  parseQtyInput,
  toBaseQty,
} from '@pos/core/quantity';
import { ingredientUnitChoices, itemUnitChoices, reservedUnitCode, unitFactor } from '@pos/core/units';

const flour = ingredientUnitChoices(makeIngredient(), UNIT_CATALOG);
const milk = ingredientUnitChoices(makeMilk(), UNIT_CATALOG);

describe('worked example G (conversions)', () => {
  it.each([
    ['Flour 2 sack', flour, '2', 'sack', '50000.000'],
    ['Flour 1.5 cup', flour, '1.5', 'cup', '180.000'],
    ['Flour 8 oz (226.796185)', flour, '8', 'oz', '226.796'],
    ['Milk 1 cup (236.5882365)', milk, '1', 'cup', '236.588'],
    ['Milk 2 tbsp (29.5735295625)', milk, '2', 'tbsp', '29.574'],
  ])('%s', (_label, choices, qty, unit, expected) => {
    const factor = unitFactor(choices, unit);
    expect(factor).not.toBeNull();
    expect(toBaseQty(qty, factor as string)).toBe(expected);
  });

  it('Flour 3 tbsp is not a valid unit (the server answers 422 `Add "tbsp" to Flour\'s units first.`)', () => {
    expect(unitFactor(flour, 'tbsp')).toBeNull();
  });

  it('the live preview shows the base quantity with a friendlier unit', () => {
    expect(basePreview('2', 'sack', flour)).toBe('= 50,000 g (50 kg)');
    expect(basePreview('8', 'oz', flour)).toBe('= 226.796 g');
    expect(basePreview('1', 'cup', milk)).toBe('= 236.588 mL');
    expect(basePreview('2', 'g', flour)).toBeNull();
    expect(basePreview('2', 'tbsp', flour)).toBeNull();
  });
});

describe('exact rounding', () => {
  it('rounds half away from zero', () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
    expect(toBaseQty('0.0005', '1')).toBe('0.001');
    expect(toBaseQty('-0.2', '25000')).toBe('-5000.000');
  });

  it('never goes through a float (0.1 × 3 is exactly 0.300)', () => {
    expect(toBaseQty('0.1', '3')).toBe('0.300');
  });

  it('example G money: a line total is round_half_up(unit price × qty) and example H cost per kg', () => {
    expect(lineTotalCents(120000, '2.000')).toBe(240000);
    expect(lineTotalCents(333, '1.5')).toBe(500);
    // 1 kg of flour at avg_cost 4.666667 centavos per g → ₱46.67.
    expect(costForBaseUnits('4.666667', 1000n)).toBe(4667);
    // Example H step 4: 240 g consumed → 1120 centavos.
    expect(costForBaseUnits('4.666667', 240n)).toBe(1120);
  });
});

describe('valid units per item (§A)', () => {
  it('an ingredient offers its own units first, then the catalog units of its dimension', () => {
    expect(flour.own.map((unit) => unit.code)).toEqual(['sack', 'cup']);
    expect(flour.catalog.map((unit) => unit.code)).toEqual(['mg', 'g', 'kg', 'oz', 'lb']);
    expect(milk.catalog.map((unit) => unit.code)).toContain('tbsp');
  });

  it('an own-stock product counts in pc only', () => {
    const product = itemUnitChoices('product', null, UNIT_CATALOG);
    expect(product.own).toEqual([]);
    expect(product.catalog.map((unit) => unit.code)).toEqual(['pc']);
  });

  it('an own unit may not reuse a standard code of its own dimension (any case), but may reuse another dimension', () => {
    expect(reservedUnitCode('kg', 'g', UNIT_CATALOG)).toBe('kg');
    expect(reservedUnitCode('KG', 'g', UNIT_CATALOG)).toBe('kg');
    expect(reservedUnitCode('g', 'g', UNIT_CATALOG)).toBe('g');
    expect(reservedUnitCode('cup', 'g', UNIT_CATALOG)).toBeNull();
    expect(reservedUnitCode('sack', 'g', UNIT_CATALOG)).toBeNull();
  });
});

describe('input and display', () => {
  it('accepts at most 3 decimals, > 0, ≤ 1,000,000, and returns the canonical text', () => {
    expect(parseQtyInput('1.50')).toEqual({ ok: true, value: '1.5', scaled: 1500n });
    expect(parseQtyInput('1.2345')).toEqual({ ok: false, problem: 'decimals' });
    expect(parseQtyInput('0')).toEqual({ ok: false, problem: 'zero' });
    expect(parseQtyInput('-1')).toEqual({ ok: false, problem: 'negative' });
    expect(parseQtyInput('1000001')).toEqual({ ok: false, problem: 'max' });
    expect(parseQtyInput('abc')).toEqual({ ok: false, problem: 'format' });
    expect(parseQtyInput('0', { allowZero: true }).ok).toBe(true);
    expect(parseFactorInput('28.349523125')).toMatchObject({ ok: true, value: '28.349523125' });
    expect(parseFactorInput('1.12345678901')).toEqual({ ok: false, problem: 'decimals' });
  });

  it('shows quantities grouped, without trailing zeros, with a friendlier unit where it helps', () => {
    expect(formatQty('25000.000')).toBe('25,000');
    expect(formatQty('226.796')).toBe('226.796');
    expect(friendlyQty('25000.000', 'g')).toBe('25 kg');
    expect(friendlyQty('999.000', 'g')).toBeNull();
    expect(friendlyQty('24.000', 'pc')).toBeNull();
    expect(formatBaseQty('1500.000', 'mL')).toBe('1,500 mL (1.5 L)');
  });
});

describe('receiving projection (worked example I)', () => {
  const line = makePoLine();

  it('status by received base vs ordered base', () => {
    expect(statusForReceived(0n, 50000000n)).toBe('pending');
    expect(statusForReceived(25000000n, 50000000n)).toBe('partial');
    expect(statusForReceived(50000000n, 50000000n)).toBe('complete');
    expect(statusForReceived(55000000n, 50000000n)).toBe('over_received');
  });

  it('1 sack → partial; then 1.2 sack → over-received; a −0.2 sack correction → complete', () => {
    expect(projectLine(line, { qty: '1', unit: 'sack', correction: false, reason: '' }, flour).status).toBe('partial');
    const afterFirst = makePoLine({ received_base_qty: '25000.000', received_qty: '1.000', receiving_status: 'partial' });
    expect(projectLine(afterFirst, { qty: '1.2', unit: 'sack', correction: false, reason: '' }, flour).status).toBe('over_received');
    const afterSecond = makePoLine({ received_base_qty: '55000.000', received_qty: '2.200', receiving_status: 'over_received' });
    expect(projectLine(afterSecond, { qty: '0.2', unit: 'sack', correction: true, reason: 'Counted wrong' }, flour).status).toBe('complete');
  });

  it('entered in another unit: 25 kg on a sack line is one sack', () => {
    expect(projectLine(line, { qty: '25', unit: 'kg', correction: false, reason: '' }, flour).status).toBe('partial');
    expect(projectLine(line, { qty: '50', unit: 'kg', correction: false, reason: '' }, flour).status).toBe('complete');
  });

  it('a correction below zero is caught', () => {
    const received = makePoLine({ received_base_qty: '25000.000', received_qty: '1.000' });
    expect(projectLine(received, { qty: '2', unit: 'sack', correction: true, reason: 'x' }, flour).belowZero).toBe('Only 1 sack was received.');
  });
});
