/**
 * App-wide feature flags (display only: no flag changes pricing, money,
 * payloads or stored data).
 */

/**
 * Show the VAT breakdown (VATable sales, VAT, VAT-exempt sales, the "VAT
 * included" cart row and the per-line "VAT-exempt" tags) in the sell,
 * checkout and orders screens and on the printed receipt and refund slip.
 *
 * **Off until the POS is BIR-accredited**: until then the receipt is a
 * temporary internal receipt and must not show VAT. Flipping it to `true`
 * restores every VAT line. The amounts are still computed and sent as before,
 * and the SC/PWD "VAT exempted" deduction always shows (it changes what is
 * paid). Reports, the X/Z reads and the product form are not affected.
 */
export const SHOW_VAT_BREAKDOWN: boolean = false;

/** Reads {@link SHOW_VAT_BREAKDOWN} (a function so tests can mock it). */
export function showVatBreakdown(): boolean {
  return SHOW_VAT_BREAKDOWN;
}
