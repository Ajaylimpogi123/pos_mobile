/**
 * Text for the printer (docs/api-contract.md → Printing → ESC/POS): code page
 * 437, selected with `ESC t 0` at the start of every document.
 *
 * `toPrintable` runs on **every** printed string before it is measured or encoded:
 * 1. Control characters are stripped (C0 `U+0000–U+001F`, `DEL`, C1
 *    `U+0080–U+009F`), so a note or a name can never inject a printer command
 *    (e.g. `ESC`, `GS`, or a stray line feed). Tabs and line breaks become a
 *    space first, so the words on either side stay apart.
 * 2. Invisible format characters (zero-width spaces and joiners, variation
 *    selectors, BOM) are dropped.
 * 3. Characters outside CP437 are transliterated: `₱` → `P`, curly quotes →
 *    straight ones, dashes → `-`, `…` → `...`, accented Latin letters CP437
 *    lacks → the plain letter. Anything else (e.g. emoji) becomes `?`.
 * The result holds only characters CP437 can encode, one byte each, so its
 * length is its printed width in columns.
 */

/** CP437 bytes 0x80–0xFF, in order. */
const HIGH_HALF =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Unicode code point → CP437 byte, for the upper half. */
const TO_CP437 = new Map<number, number>();
Array.from(HIGH_HALF).forEach((character, index) => {
  TO_CP437.set(character.codePointAt(0) as number, 0x80 + index);
});

/** Replacements for common characters CP437 lacks. */
const TRANSLITERATIONS: Record<string, string> = {
  '₱': 'P',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
  '…': '...',
  '•': '*',
  '×': 'x',
  '€': 'EUR',
  // A non-breaking space is 0xFF in CP437, but many printers show it as a box.
  ' ': ' ',
  // Latin letters CP437 doesn't have: the plain letter.
  'À': 'A',
  'Á': 'A',
  'Â': 'A',
  'Ã': 'A',
  'È': 'E',
  'Ê': 'E',
  'Ë': 'E',
  'Ì': 'I',
  'Í': 'I',
  'Î': 'I',
  'Ï': 'I',
  'Ò': 'O',
  'Ó': 'O',
  'Ô': 'O',
  'Õ': 'O',
  'Ø': 'O',
  'Ù': 'U',
  'Ú': 'U',
  'Û': 'U',
  'Ý': 'Y',
  'ã': 'a',
  'õ': 'o',
  'ø': 'o',
  'ý': 'y',
  'Ð': 'D',
  'ð': 'd',
  'Þ': 'Th',
  'þ': 'th',
  'Œ': 'OE',
  'œ': 'oe',
  'Š': 'S',
  'š': 's',
  'Ž': 'Z',
  'ž': 'z',
  'Ÿ': 'Y',
};

/** Shown for any character that can't be printed. */
export const UNPRINTABLE = '?';

function isControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/** Zero-width and format characters that print nothing. */
function isInvisible(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    (code >= 0xe0100 && code <= 0xe01ef)
  );
}

/** Combining diacritical marks (a decomposed "é" is "e" + U+0301). */
function isCombiningMark(code: number): boolean {
  return code >= 0x0300 && code <= 0x036f;
}

/** Whether CP437 can encode this character as one byte. */
export function isCp437(character: string): boolean {
  const code = character.codePointAt(0) as number;
  if (code >= 0x20 && code <= 0x7e) return true;
  return TO_CP437.has(code) && code !== 0xa0;
}

/** Tries the plain letter of an accented character via Unicode decomposition. */
function stripAccents(character: string): string | null {
  try {
    const plain = character.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return plain !== '' && plain !== character && Array.from(plain).every(isCp437) ? plain : null;
  } catch {
    return null;
  }
}

/**
 * `text` as characters the printer can show (see the module notes). Idempotent:
 * `toPrintable(toPrintable(x)) === toPrintable(x)`.
 */
export function toPrintable(text: string): string {
  let source = text;
  try {
    // Composed form first, so a decomposed "é" (e + U+0301) prints as CP437's é.
    source = text.normalize('NFC');
  } catch {
    // No normalization available: combining marks are dropped below.
  }
  let result = '';
  for (const character of source) {
    const code = character.codePointAt(0) as number;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      result += ' ';
      continue;
    }
    if (isControl(code) || isInvisible(code) || isCombiningMark(code)) continue;
    if (isCp437(character)) {
      result += character;
      continue;
    }
    result += TRANSLITERATIONS[character] ?? stripAccents(character) ?? UNPRINTABLE;
  }
  return result;
}

/** Encodes `text` (made printable first) as CP437 bytes. Never emits a byte below 0x20. */
export function encodeCp437(text: string): Uint8Array {
  const printable = toPrintable(text);
  const bytes: number[] = [];
  for (const character of printable) {
    const code = character.codePointAt(0) as number;
    bytes.push(code < 0x80 ? code : (TO_CP437.get(code) ?? UNPRINTABLE.charCodeAt(0)));
  }
  return Uint8Array.from(bytes);
}

/** CP437 byte → Unicode character (for decoders and tests). */
export function decodeCp437Byte(byte: number): string {
  if (byte < 0x80) return String.fromCharCode(byte);
  return Array.from(HIGH_HALF)[byte - 0x80];
}
