import { centsToInputText, formatAmount, formatPeso, parsePesoInput } from '@pos/core/money';

describe('formatPeso', () => {
  it.each([
    [125050, '₱1,250.50'],
    [5000, '₱50.00'],
    [0, '₱0.00'],
    [1, '₱0.01'],
    [10, '₱0.10'],
    [99, '₱0.99'],
    [100, '₱1.00'],
    [3500, '₱35.00'],
    [99999, '₱999.99'],
    [100000, '₱1,000.00'],
    [12345678, '₱123,456.78'],
    [100000000, '₱1,000,000.00'],
    [123456789012, '₱1,234,567,890.12'],
    [-150, '-₱1.50'],
    [-125050, '-₱1,250.50'],
  ])('formats %d centavos as %s', (cents, expected) => {
    expect(formatPeso(cents)).toBe(expected);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects a non-integer amount (%p)', (value) => {
    expect(() => formatPeso(value)).toThrow(TypeError);
  });
});

describe('centsToInputText', () => {
  it.each([
    [125050, '1250.50'],
    [5000, '50.00'],
    [0, '0.00'],
    [5, '0.05'],
    [50, '0.50'],
    [100000000, '1000000.00'],
    [-150, '-1.50'],
  ])('turns %d centavos into %p', (cents, expected) => {
    expect(centsToInputText(cents)).toBe(expected);
  });

  it('round-trips through parsePesoInput for non-negative amounts', () => {
    for (const cents of [0, 1, 9, 10, 29, 99, 100, 101, 5000, 5050, 125050, 99999999, 100000000]) {
      expect(parsePesoInput(centsToInputText(cents))).toBe(cents);
    }
  });
});

describe('parsePesoInput', () => {
  it.each([
    ['50', 5000],
    ['50.', 5000],
    ['50.5', 5050],
    ['50.50', 5050],
    ['50.05', 5005],
    ['50.00', 5000],
    ['0', 0],
    ['0.0', 0],
    ['0.00', 0],
    ['0.01', 1],
    ['0.1', 10],
    ['.5', 50],
    ['.05', 5],
    ['1250.50', 125050],
    ['1,250.50', 125050],
    ['1,250', 125000],
    ['1,000,000', 100000000],
    ['1,000,000.00', 100000000],
    ['1000000', 100000000],
    ['007', 700],
    ['007.5', 750],
    ['  35  ', 3500],
    ['₱50', 5000],
    ['₱ 1,250.50', 125050],
  ])('parses %p as %d centavos', (text, expected) => {
    expect(parsePesoInput(text)).toBe(expected);
  });

  it.each([
    // Values where float math (x * 100) would drift: the string parse stays exact.
    ['0.29', 29],
    ['0.57', 57],
    ['1.15', 115],
    ['4.35', 435],
    ['1.10', 110],
    ['19.99', 1999],
    ['1234567.89', 123456789],
  ])('parses %p exactly as %d (no floating-point drift)', (text, expected) => {
    const cents = parsePesoInput(text);
    expect(cents).toBe(expected);
    expect(Number.isInteger(cents)).toBe(true);
  });

  it.each([
    '',
    '   ',
    '₱',
    '.',
    '50.505',
    '1.001',
    '0.000',
    '-1',
    '-0.50',
    '+5',
    'abc',
    '5a',
    '12abc',
    '1e3',
    '1E2',
    '0x10',
    '5..0',
    '5.0.0',
    '1,2345',
    '12,50',
    ',100',
    '1,000,00',
    '1,,000',
    '1 000',
    '50,',
    'NaN',
    'Infinity',
    '₱-5',
    '5₱',
    '١٢',
  ])('rejects %p', (text) => {
    expect(parsePesoInput(text)).toBeNull();
  });

  it('rejects amounts beyond the safe-integer range instead of losing precision', () => {
    expect(parsePesoInput('999999999999999999')).toBeNull();
  });
});

describe('formatAmount (printed receipts: no peso sign)', () => {
  it.each([
    [125050, '1,250.50'],
    [25700, '257.00'],
    [800, '8.00'],
    [5, '0.05'],
    [0, '0.00'],
    [-800, '-8.00'],
    [100000000000, '1,000,000,000.00'],
  ])('%i → %s', (cents, text) => {
    expect(formatAmount(cents)).toBe(text);
  });

  it('refuses a non-integer, like formatPeso', () => {
    expect(() => formatAmount(12.5)).toThrow(TypeError);
  });
});
