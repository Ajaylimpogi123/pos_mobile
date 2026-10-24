/**
 * The optional table number of a sale (docs/api-contract.md → Table Number
 * (Core Sale revision 2)): the server's rule, checked on the device too.
 * Surrounding spaces are trimmed; empty means no table (`null`).
 */

/** Contract: `max:10`, `regex:/^[A-Za-z0-9 -]+$/`. */
export const TABLE_NO_MAX = 10;
const TABLE_NO_PATTERN = /^[A-Za-z0-9 -]+$/;

export const TABLE_NO_TOO_LONG = `Use ${TABLE_NO_MAX} characters or fewer.`;
export const TABLE_NO_INVALID = 'Use letters, numbers, spaces and hyphens only.';

export type ParsedTableNo = { value: string | null; error: string | null };

/** What the cashier typed, as the request's `table_no` (or the reason it can't be sent). */
export function parseTableNo(text: string): ParsedTableNo {
  const value = text.trim();
  if (value === '') return { value: null, error: null };
  if (value.length > TABLE_NO_MAX) return { value: null, error: TABLE_NO_TOO_LONG };
  if (!TABLE_NO_PATTERN.test(value)) return { value: null, error: TABLE_NO_INVALID };
  return { value, error: null };
}
