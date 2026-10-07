/**
 * Test-only: a small ESC/POS decoder for the documents the app builds. Never
 * import from app code (the dev fake printer has its own decoder).
 *
 * - `decodeEscPos(bytes)`: the text with a marker for every command, e.g.
 *   `[INIT][CENTER][BOLD]Main Branch\n[/BOLD]…[FEED 3][CUT]`.
 * - `printedLines(bytes)`: just the printed lines (commands removed), for layout checks.
 * Unknown bytes below 0x20 throw, so a stray control character fails the test.
 */
import { decodeCp437Byte } from '@/printing/escpos/cp437';

const ALIGN = ['[LEFT]', '[CENTER]', '[RIGHT]'];

function sizeMarker(n: number): string {
  const width = ((n >> 4) & 0x0f) + 1;
  const height = (n & 0x0f) + 1;
  if (width === 1 && height === 1) return '[1x]';
  if (width === 2 && height === 2) return '[2x]';
  if (width === 2) return '[2w]';
  return '[2h]';
}

export function decodeEscPos(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    const next = bytes[index + 1];
    if (byte === 0x0a) {
      out += '\n';
    } else if (byte === 0x1b && next === 0x40) {
      out += '[INIT]';
      index += 1;
    } else if (byte === 0x1b && next === 0x74) {
      out += `[CP${bytes[index + 2]}]`;
      index += 2;
    } else if (byte === 0x1b && next === 0x61) {
      out += ALIGN[bytes[index + 2]] ?? '[ALIGN?]';
      index += 2;
    } else if (byte === 0x1b && next === 0x45) {
      out += bytes[index + 2] ? '[BOLD]' : '[/BOLD]';
      index += 2;
    } else if (byte === 0x1b && next === 0x64) {
      out += `[FEED ${bytes[index + 2]}]`;
      index += 2;
    } else if (byte === 0x1d && next === 0x21) {
      out += sizeMarker(bytes[index + 2]);
      index += 2;
    } else if (byte === 0x1d && next === 0x56) {
      out += '[CUT]';
      index += 2;
    } else if (byte === 0x1c && next === 0x2e) {
      out += '[KANJI OFF]';
      index += 1;
    } else if (byte < 0x20 || byte === 0x7f) {
      throw new Error(`Unexpected control byte 0x${byte.toString(16)} at ${index}`);
    } else {
      out += decodeCp437Byte(byte);
    }
  }
  return out;
}

/** The printed lines only (every command marker removed). The text after the last line feed is dropped. */
export function printedLines(bytes: Uint8Array): string[] {
  const text = decodeEscPos(bytes).replace(/\[(?:INIT|KANJI OFF|CP\d+|LEFT|CENTER|RIGHT|ALIGN\?|\/?BOLD|FEED \d+|CUT|1x|2x|2w|2h)\]/g, '');
  const lines = text.split('\n');
  lines.pop();
  return lines;
}
