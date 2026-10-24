/**
 * Plain-text layout for fixed-width thermal paper (docs/api-contract.md →
 * Printing → ESC/POS → Columns). Every function measures the **printable**
 * text (`toPrintable`: one CP437 byte per character), so a transliterated
 * `…` → `...` or a stripped control character never breaks the alignment.
 * Pure functions: the builder calls them, and tests check them directly.
 */
import type { PaperWidthMm } from '../../contract/types';

import { toPrintable } from './cp437';

/** Characters per line at normal size: 32 at 58 mm and 48 at 80 mm. Double width halves them. */
export const COLUMNS: Record<PaperWidthMm, number> = { 58: 32, 80: 48 };

export function columnsFor(paperWidthMm: PaperWidthMm): number {
  return COLUMNS[paperWidthMm] ?? COLUMNS[80];
}

/**
 * Word-wraps `text` to `width` columns. Leading spaces of the first line are
 * kept; later lines start with `indent` spaces (a hanging indent). A word
 * longer than a line is broken. Always at least one line (`['']` for empty text).
 */
export function wrap(text: string, width: number, indent = 0): string[] {
  const printable = toPrintable(text);
  const lineWidth = Math.max(1, Math.trunc(width));
  const lead = (/^ */.exec(printable)?.[0] ?? '').slice(0, lineWidth - 1);
  const hanging = ' '.repeat(Math.max(0, Math.min(Math.trunc(indent), lineWidth - 1)));
  const words = printable.split(' ').filter((word) => word !== '');
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = lead;
  let empty = true;
  for (const word of words) {
    let remaining = word;
    while (remaining.length > 0) {
      const room = lineWidth - line.length - (empty ? 0 : 1);
      if (remaining.length <= room) {
        line += (empty ? '' : ' ') + remaining;
        empty = false;
        remaining = '';
      } else if (!empty) {
        lines.push(line);
        line = hanging;
        empty = true;
      } else {
        const take = Math.max(1, lineWidth - line.length);
        lines.push(line + remaining.slice(0, take));
        remaining = remaining.slice(take);
        line = hanging;
      }
    }
  }
  if (!empty) lines.push(line);
  return lines;
}

/**
 * `left` and a right-aligned `right` on one line (e.g. an item and its
 * amount). A long `left` wraps into the room left of the amount; its later
 * lines are indented 2 past its own leading spaces. An amount wider than the
 * line goes on a line of its own, right-aligned.
 */
export function twoColumns(left: string, right: string, width: number): string[] {
  const lineWidth = Math.max(1, Math.trunc(width));
  const amount = toPrintable(right);
  const printableLeft = toPrintable(left);
  if (amount.length >= lineWidth) return [...wrap(printableLeft, lineWidth), amount.slice(0, lineWidth).padStart(lineWidth)];

  const leftWidth = lineWidth - amount.length - 1;
  const lead = /^ */.exec(printableLeft)?.[0].length ?? 0;
  const [first, ...rest] = wrap(printableLeft, leftWidth, lead + 2);
  return [first.padEnd(lineWidth - amount.length) + amount, ...rest];
}

/**
 * A label column and a value (e.g. `No.        INV-MAIN-00000042`): the label
 * is padded to `labelWidth`, and a long value wraps under the value column.
 */
export function keyValue(label: string, value: string, labelWidth: number, width: number): string[] {
  const lineWidth = Math.max(2, Math.trunc(width));
  const column = Math.max(1, Math.min(Math.trunc(labelWidth), lineWidth - 1));
  const printableLabel = toPrintable(label);
  // A label wider than its column: label and value simply wrap together.
  if (printableLabel.length >= column) return wrap(`${printableLabel} ${toPrintable(value)}`, lineWidth, column);
  return wrap(value, lineWidth - column).map((line, index) => (index === 0 ? printableLabel.padEnd(column) : ' '.repeat(column)) + line);
}

/**
 * `parts` joined by `gap` spaces on one line when they fit (e.g. the invoice
 * and the time on a ticket), otherwise word-wrapped.
 */
export function joinOrWrap(parts: readonly string[], width: number, gap = 2): string[] {
  const joined = parts.map(toPrintable).join(' '.repeat(gap));
  return joined.length <= width ? [joined] : wrap(joined, width);
}

/** Centres each wrapped line with leading spaces (for printers or places without `ESC a 1`). */
export function centre(text: string, width: number): string[] {
  const lineWidth = Math.max(1, Math.trunc(width));
  return wrap(toPrintable(text).trim(), lineWidth).map((line) => {
    const padding = Math.floor((lineWidth - line.length) / 2);
    return `${' '.repeat(Math.max(0, padding))}${line}`;
  });
}

/** A full-width rule, e.g. `--------------------------------`. */
export function divider(width: number, character = '-'): string {
  const mark = toPrintable(character).charAt(0) || '-';
  return mark.repeat(Math.max(1, Math.trunc(width)));
}
