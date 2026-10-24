/**
 * The ESC/POS commands the app sends (docs/api-contract.md → Printing →
 * ESC/POS). Every document starts with `INIT` and ends with `CUT`. Nothing
 * else is ever sent: no status queries, no cash drawer.
 */

export const ESC = 0x1b;
export const GS = 0x1d;
export const FS = 0x1c;
export const LF = 0x0a;

/**
 * Start of every document: `ESC @` (reset), `FS .` (cancel Kanji mode, which
 * some Asian-market printers start in), `ESC t 0` (code page 437).
 */
export const INIT = [ESC, 0x40, FS, 0x2e, ESC, 0x74, 0x00] as const;

/** End of every document: `ESC d 3` (feed 3 lines past the cutter), `GS V 1` (partial cut). */
export const CUT = [ESC, 0x64, 0x03, GS, 0x56, 0x01] as const;

export type Alignment = 'left' | 'center' | 'right';

const ALIGNMENT_VALUES: Record<Alignment, number> = { left: 0, center: 1, right: 2 };

/** `ESC a n`: 0 left, 1 centre, 2 right. */
export function align(alignment: Alignment): number[] {
  return [ESC, 0x61, ALIGNMENT_VALUES[alignment]];
}

/** `ESC E n`: emphasised (bold) on or off. */
export function bold(on: boolean): number[] {
  return [ESC, 0x45, on ? 1 : 0];
}

/** Character size multiplier: 1 (normal) or 2 (double). */
export type SizeFactor = 1 | 2;

/** `GS ! n`: width multiplier in the high nibble, height in the low nibble (0 = normal). */
export function size(width: SizeFactor, height: SizeFactor): number[] {
  return [GS, 0x21, ((width - 1) << 4) | (height - 1)];
}

/** `ESC d n`: print and feed `lines` lines (0–255). */
export function feed(lines: number): number[] {
  return [ESC, 0x64, Math.max(0, Math.min(255, Math.trunc(lines)))];
}
