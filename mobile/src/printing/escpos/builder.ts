/**
 * A small fluent ESC/POS builder (no npm package): commands from
 * `./commands`, text through CP437 (`./cp437`, which strips control
 * characters), layout from `./layout`. `build()` returns the bytes to send.
 *
 *   new EscPosBuilder(48).init().align('center').bold(true).line('Main Branch').cut().build()
 *
 * The builder tracks the character width, so `width` (and every layout
 * helper) is halved while double-width text is on.
 */
import { align, bold, CUT, feed, INIT, LF, size, type Alignment, type SizeFactor } from './commands';
import { encodeCp437 } from './cp437';
import { divider, joinOrWrap, keyValue, twoColumns, wrap } from './layout';

export class EscPosBuilder {
  private readonly bytes: number[] = [];
  private widthFactor: SizeFactor = 1;

  /** `columns`: characters per line at normal size (32 or 48). */
  constructor(readonly columns: number) {}

  /** Characters per line at the current size. */
  get width(): number {
    return Math.max(1, Math.floor(this.columns / this.widthFactor));
  }

  private push(bytes: readonly number[] | Uint8Array): this {
    for (const byte of bytes) this.bytes.push(byte);
    return this;
  }

  /** Reset, cancel Kanji mode, code page 437. Normal size, left, not bold. */
  init(): this {
    this.widthFactor = 1;
    return this.push(INIT);
  }

  align(alignment: Alignment): this {
    return this.push(align(alignment));
  }

  bold(on: boolean): this {
    return this.push(bold(on));
  }

  /** Character size: `size(2, 2)` double, `size(1, 2)` double height, `size(1, 1)` normal. */
  size(width: SizeFactor, height: SizeFactor): this {
    this.widthFactor = width;
    return this.push(size(width, height));
  }

  /** Text without a line feed. */
  text(text: string): this {
    return this.push(encodeCp437(text));
  }

  /** Text, then a line feed. */
  line(text = ''): this {
    return this.text(text).push([LF]);
  }

  lines(texts: readonly string[]): this {
    for (const text of texts) this.line(text);
    return this;
  }

  /** Word-wrapped to the current width; later lines indented by `indent`. */
  wrapped(text: string, indent = 0): this {
    return this.lines(wrap(text, this.width, indent));
  }

  /** `left` with a right-aligned `right` (e.g. an item and its amount). */
  pair(left: string, right: string): this {
    return this.lines(twoColumns(left, right, this.width));
  }

  /** Parts on one line with a gap of `gap` spaces when they fit, else wrapped. */
  joined(parts: readonly string[], gap = 2): this {
    return this.lines(joinOrWrap(parts, this.width, gap));
  }

  /** A padded label column and a wrapped value. */
  keyValue(label: string, value: string, labelWidth: number): this {
    return this.lines(keyValue(label, value, labelWidth, this.width));
  }

  divider(character = '-'): this {
    return this.line(divider(this.width, character));
  }

  feed(lines: number): this {
    return this.push(feed(lines));
  }

  /** Feed past the cutter and cut. */
  cut(): this {
    return this.push(CUT);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
