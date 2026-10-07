/**
 * The in-house ESC/POS layer (docs/api-contract.md → Printing → ESC/POS):
 * CP437 encoding with transliteration and control stripping, exact builder
 * bytes, and the fixed-width layout helpers.
 */
import { EscPosBuilder } from '@/printing/escpos/builder';
import { decodeCp437Byte, encodeCp437, isCp437, toPrintable } from '@/printing/escpos/cp437';
import { centre, columnsFor, divider, joinOrWrap, keyValue, twoColumns, wrap } from '@/printing/escpos/layout';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('cp437', () => {
  it('encodes ASCII as itself and the CP437 letters staff names use', () => {
    expect(encodeCp437('Egg 50')).toEqual(bytes(0x45, 0x67, 0x67, 0x20, 0x35, 0x30));
    expect(encodeCp437('ñÑéÉüç')).toEqual(bytes(0xa4, 0xa5, 0x82, 0x90, 0x81, 0x87));
    expect(encodeCp437('½°£')).toEqual(bytes(0xab, 0xf8, 0x9c));
    // A decomposed "é" (e + U+0301) prints as CP437's é.
    expect(encodeCp437('é')).toEqual(bytes(0x82));
  });

  it('round-trips every CP437 byte from 0x80 to 0xFE', () => {
    for (let byte = 0x80; byte < 0xff; byte += 1) {
      const character = decodeCp437Byte(byte);
      expect(isCp437(character)).toBe(true);
      expect(encodeCp437(character)).toEqual(bytes(byte));
    }
  });

  it('transliterates: ₱ → P, curly quotes, dashes, ellipsis, and accented letters CP437 lacks', () => {
    expect(toPrintable('₱1,250.50')).toBe('P1,250.50');
    expect(toPrintable('“Kuya’s” ‘best’')).toBe('"Kuya\'s" \'best\'');
    expect(toPrintable('Rice – large — hot − cold')).toBe('Rice - large - hot - cold');
    expect(toPrintable('Wait…')).toBe('Wait...');
    expect(toPrintable('Ãtis Õ São João')).toBe('Atis O Sao Joao');
    expect(toPrintable('Niño Peña é ₱')).toBe('Niño Peña é P');
  });

  it('turns emoji and other scripts into "?", and drops invisible joiners and variation selectors', () => {
    expect(toPrintable('Iced 🧋')).toBe('Iced ?');
    expect(toPrintable('❤️')).toBe('?');
    expect(toPrintable('a​b﻿c')).toBe('abc');
    expect(toPrintable('寿司')).toBe('??');
  });

  it('strips control characters so a note can never inject a printer command', () => {
    const note = 'No\u001b@ketchup\u001dV\u0001\u0000!\u007f\u0085';
    expect(toPrintable(note)).toBe('No@ketchupV!');
    const encoded = encodeCp437(`x${String.fromCharCode(0x1b, 0x64, 0x05, 0x1d, 0x56, 0x00)}y`);
    expect(Array.from(encoded).every((byte) => byte >= 0x20)).toBe(true);
    // ESC d 5 and GS V 0 lose their control bytes: only the harmless letters "d" and "V" remain.
    expect(encoded).toEqual(bytes(0x78, 0x64, 0x56, 0x79));
  });

  it('turns tabs and line breaks into spaces, and is idempotent', () => {
    expect(toPrintable('Line 1\nLine 2\r\n\tIndented')).toBe('Line 1 Line 2   Indented');
    const text = 'Niño – “x” … 🧋\u001b';
    expect(toPrintable(toPrintable(text))).toBe(toPrintable(text));
  });
});

describe('EscPosBuilder', () => {
  it('writes init, alignment, bold, size, text, feed and cut as exact bytes', () => {
    const output = new EscPosBuilder(32)
      .init()
      .align('center')
      .bold(true)
      .line('Hi')
      .bold(false)
      .size(2, 2)
      .text('#1')
      .size(1, 2)
      .size(1, 1)
      .align('right')
      .align('left')
      .feed(2)
      .cut()
      .build();

    expect(output).toEqual(
      bytes(
        0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x00, // ESC @, FS ., ESC t 0
        0x1b, 0x61, 0x01, // ESC a 1
        0x1b, 0x45, 0x01, // ESC E 1
        0x48, 0x69, 0x0a, // "Hi" LF
        0x1b, 0x45, 0x00, // ESC E 0
        0x1d, 0x21, 0x11, // GS ! 0x11 (double)
        0x23, 0x31, // "#1"
        0x1d, 0x21, 0x01, // GS ! 0x01 (double height)
        0x1d, 0x21, 0x00, // GS ! 0x00
        0x1b, 0x61, 0x02, // ESC a 2
        0x1b, 0x61, 0x00, // ESC a 0
        0x1b, 0x64, 0x02, // ESC d 2
        0x1b, 0x64, 0x03, 0x1d, 0x56, 0x01, // cut: ESC d 3, GS V 1
      ),
    );
  });

  it('halves the width while double-width text is on', () => {
    const builder = new EscPosBuilder(48);
    expect(builder.width).toBe(48);
    builder.size(2, 2);
    expect(builder.width).toBe(24);
    builder.size(1, 2);
    expect(builder.width).toBe(48);
  });

  it('lays out pairs, key-values and dividers at the current width', () => {
    const output = new EscPosBuilder(20).pair('Total', '₱5.00').keyValue('No.', 'INV-1', 5).divider().build();
    expect(new TextDecoder().decode(output)).toBe('Total          P5.00\nNo.  INV-1\n--------------------\n');
  });
});

describe('layout', () => {
  it('uses 32 columns at 58 mm and 48 at 80 mm', () => {
    expect(columnsFor(58)).toBe(32);
    expect(columnsFor(80)).toBe(48);
  });

  it('wraps words, breaks words longer than a line, and keeps a hanging indent', () => {
    expect(wrap('The quick brown fox jumps', 10)).toEqual(['The quick', 'brown fox', 'jumps']);
    expect(wrap('ABCDEFGHIJKLMN', 5)).toEqual(['ABCDE', 'FGHIJ', 'KLMN']);
    expect(wrap('  > no onions and no pickles', 12, 4)).toEqual(['  > no', '    onions', '    and no', '    pickles']);
    expect(wrap('', 10)).toEqual(['']);
  });

  it('right-aligns the amount and wraps a long label beside it', () => {
    expect(twoColumns('1 x Hot Dog', '80.00', 32)).toEqual(['1 x Hot Dog                80.00']);
    expect(twoColumns('2 x Extra Large Chicken Inasal Family Meal', '1,250.00', 32)).toEqual([
      '2 x Extra Large Chicken 1,250.00',
      '  Inasal Family Meal',
    ]);
    expect(twoColumns('  Promo 10%', '-8.00', 32)).toEqual(['  Promo 10%                -8.00']);
  });

  it('pads the label column and wraps a long value under the value column', () => {
    expect(keyValue('Cashier', 'Carla Cashier', 11, 32)).toEqual(['Cashier    Carla Cashier']);
    expect(keyValue('Customer', 'Maria Clara Santos de la Cruz', 11, 32)).toEqual([
      'Customer   Maria Clara Santos de',
      '           la Cruz',
    ]);
  });

  it('centres with spaces, draws dividers, and joins parts when they fit', () => {
    expect(centre('Main', 10)).toEqual(['   Main']);
    expect(divider(5)).toBe('-----');
    expect(joinOrWrap(['INV-MAIN-00000042', '12:12 PM'], 32)).toEqual(['INV-MAIN-00000042  12:12 PM']);
    expect(joinOrWrap(['INV-MAIN-00000042', '12:12 PM'], 20)).toEqual(['INV-MAIN-00000042', '12:12 PM']);
  });

  it('measures transliterated text, so "…" takes three columns', () => {
    expect(twoColumns('Wait…', '1.00', 12)).toEqual(['Wait... 1.00']);
  });
});
