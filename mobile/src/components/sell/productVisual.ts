import { colors } from '@/constants/theme';

/** The tinted panel and the ink of a product's initial (tile image area, cart-line thumbnail). */
export type ProductTint = {
  background: string;
  ink: string;
  /** Prebuilt styles, so list rows don't allocate them on every render. */
  backgroundStyle: { backgroundColor: string };
  inkStyle: { color: string };
};

function tint(background: string, ink: string): ProductTint {
  return { background, ink, backgroundStyle: { backgroundColor: background }, inkStyle: { color: ink } };
}

/**
 * The three placeholder tints of the design (soft green, warm, neutral),
 * picked by product id so a product always keeps the same one.
 */
const TINTS: readonly ProductTint[] = [
  tint(colors.primarySoft, colors.primary),
  tint(colors.highlightSoft, colors.highlightText),
  tint(colors.surfaceMuted, colors.textResting),
];

export function productTint(productId: number): ProductTint {
  return TINTS[Math.abs(productId) % TINTS.length];
}

/** "chicken adobo" → "C". */
export function productInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
