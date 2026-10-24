/** Checkout payment maths (contract → POST /orders → payments): change, short, GCash ≤ total, split tender. */
import {
  exactCashCents,
  GCASH_OVER_TOTAL_MESSAGE,
  summarizeDraft,
  summarizePayments,
  validateTender,
  type TenderDraft,
} from '@pos/core/sale/payments';

function tender(cash: string, gcash: { amount: string; reference: string }[] = []): TenderDraft {
  return { cash, gcash: gcash.map((row, index) => ({ key: `g${index}`, ...row })) };
}

describe('summarizePayments', () => {
  it('gives the change out of cash when the payments cover the total', () => {
    expect(summarizePayments(25700, 20000, [10000])).toMatchObject({
      paidCents: 30000,
      dueCents: 0,
      changeCents: 4300,
      short: false,
      gcashOverTotal: false,
    });
  });

  it('gives the amount due while short', () => {
    expect(summarizePayments(25700, 20000, [])).toMatchObject({ paidCents: 20000, dueCents: 5700, changeCents: 0, short: true });
  });

  it('flags GCash above the total', () => {
    expect(summarizePayments(25700, 0, [25701]).gcashOverTotal).toBe(true);
    expect(summarizePayments(25700, 0, [25700])).toMatchObject({ gcashOverTotal: false, changeCents: 0, short: false });
  });
});

describe('validateTender', () => {
  it('builds cash then GCash payments (worked example B)', () => {
    const result = validateTender(25700, tender('200', [{ amount: '100', reference: '1012345678901' }]));
    expect(result.errors).toBeNull();
    expect(result.payments).toEqual([
      { method: 'cash', amount_cents: 20000, reference_no: null },
      { method: 'gcash', amount_cents: 10000, reference_no: '1012345678901' },
    ]);
    expect(result.summary.changeCents).toBe(4300);
  });

  it('refuses a short payment with the server wording', () => {
    const result = validateTender(25700, tender('200'));
    expect(result.payments).toBeNull();
    expect(result.errors?.general).toBe('The payment is short by ₱57.00.');
  });

  it('refuses GCash above the total, even with no cash', () => {
    const result = validateTender(25700, tender('', [{ amount: '300', reference: 'ABC-1' }]));
    expect(result.errors?.general).toBe(GCASH_OVER_TOTAL_MESSAGE);
  });

  it('needs a GCash reference (letters, numbers, dashes; max 64)', () => {
    const missing = validateTender(10000, tender('', [{ amount: '100', reference: '' }]));
    expect(missing.errors?.gcash.g0?.reference).toBe('Enter the GCash reference number.');
    const bad = validateTender(10000, tender('', [{ amount: '100', reference: 'REF 1' }]));
    expect(bad.errors?.gcash.g0?.reference).toBe('Use only letters, numbers and dashes.');
    const long = validateTender(10000, tender('', [{ amount: '100', reference: 'A'.repeat(65) }]));
    expect(long.errors?.gcash.g0?.reference).toBe('Use 64 characters or fewer.');
  });

  it('checks each amount', () => {
    expect(validateTender(10000, tender('abc')).errors?.cash).toMatch(/Enter an amount/);
    expect(validateTender(10000, tender('', [{ amount: '', reference: 'R1' }])).errors?.gcash.g0?.amount).toBe(
      'Enter the amount paid.',
    );
    expect(validateTender(10000, tender('10000000.01')).errors?.cash).toMatch(/can't be more than/);
  });

  it('allows no payments at all only when the total is 0', () => {
    expect(validateTender(0, tender(''))).toMatchObject({ payments: [], errors: null });
    expect(validateTender(1, tender('')).errors?.general).toBe('The payment is short by ₱0.01.');
  });
});

describe('exact cash', () => {
  it('is what the GCash payments leave to pay', () => {
    expect(exactCashCents(25700, tender('', [{ amount: '100', reference: 'R' }]))).toBe(15700);
    expect(exactCashCents(25700, tender(''))).toBe(25700);
    expect(exactCashCents(25700, tender('', [{ amount: '300', reference: 'R' }]))).toBe(0);
    expect(summarizeDraft(25700, tender('157', [{ amount: '100', reference: 'R' }]))).toMatchObject({ changeCents: 0, short: false });
  });
});
