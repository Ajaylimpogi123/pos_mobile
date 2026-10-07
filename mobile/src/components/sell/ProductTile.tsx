import { Image } from 'expo-image';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { stockBadge } from '@/components/inventory/inventoryLabels';
import { productInitial, productTint } from '@/components/sell/productVisual';
import { Chip } from '@/components/ui/Chip';
import {
  colors,
  fontFamilies,
  motion,
  numeric,
  opacity,
  pressedScale,
  radius,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import type { MenuProduct } from '@/db/menuQueries';
import type { CachedStockBadge } from '@/db/offlineRepository';
import { useCartStore, type CartLine } from '@/stores/cart';
import { formatPeso } from '@/utils/money';

// Tile anatomy (POS board): 8 / 8 / 12 padding, the image area, a 10 gap, a
// 2-line name (14 / 600), a 4 gap and the price (16 / 700). Every part has a
// fixed height, so all tiles are the same height and the grid can use
// `getItemLayout` (no measuring while scrolling).
const PAD_TOP = spacing.sm;
const PAD_BOTTOM = spacing.md;
const IMAGE_GAP = spacing.sm + spacing.xxs;
const TEXT_GAP = spacing.xs;
const NAME_LINES = 2;
const nameText = typography.control;
const priceText = { ...typography.section, ...numeric };

/** Image-area height: 72 on phones, 96 on tablets. */
export const TILE_IMAGE_HEIGHT = { compact: sizes.tileImage.phone, regular: sizes.tileImage.tablet } as const;

export type TileMetrics = {
  /** The whole tile (= one grid row without the gap). */
  height: number;
  imageHeight: number;
  nameHeight: number;
  priceHeight: number;
};

/** Fixed tile heights for an image-area height and the system font scale (text grows with it). */
export function tileMetrics(imageHeight: number, fontScale: number): TileMetrics {
  const nameHeight = Math.ceil(NAME_LINES * nameText.lineHeight * fontScale);
  const priceHeight = Math.ceil(priceText.lineHeight * fontScale);
  return {
    height: 2 * sizes.borderWidth + PAD_TOP + imageHeight + IMAGE_GAP + nameHeight + TEXT_GAP + priceHeight + PAD_BOTTOM,
    imageHeight,
    nameHeight,
    priceHeight,
  };
}

/** Σ qty of a product over the cart lines (the same product may sit on several lines). */
function qtyInCart(lines: readonly CartLine[], productId: number): number {
  let qty = 0;
  for (const line of lines) if (line.product.id === productId) qty += line.qty;
  return qty;
}

type ProductTileProps = {
  product: MenuProduct;
  metrics: TileMetrics;
  /** Users with a cart: a tap adds one. Without it the tile is read-only (the Phase 2 screen). */
  onPress?: (product: MenuProduct) => void;
  /** The cached level of a `track_stock` product (Inventory → Sell tile badges); `undefined`: none cached. */
  stock?: CachedStockBadge;
  /** §J: a recipe product with a component out (cached `/sync/stock` `recipes[].status = check`). */
  recipeCheck?: boolean;
  /** Phones and portrait (the cart is behind a bar): show how many are in the cart. */
  showCartQty?: boolean;
};

/**
 * A Sell-screen product tile (POS board): a white card (radius 16, hairline
 * border); the image on a tinted panel, or the product's initial on it; a
 * status chip top-left (`Unavailable`, `Out`, `Low · 3 left`, `Check stock`);
 * the name (2 lines) and the price in bold dark emerald. On phones, a
 * round badge top-right shows how many are in the cart.
 *
 * An unavailable product is dimmed and disabled (never tappable). An
 * out-of-stock `track_stock` product is dimmed too but **stays tappable**: an
 * online sale is still checked by the server, and offline sales never block.
 * §J: `Check stock` (a recipe component is out) stays tappable as well.
 *
 * Memoised, and the cart count is a per-tile selector, so adding to the
 * cart re-renders only the tiles whose count changed.
 */
/** The metric-sized styles, built once per `TileMetrics` object (shared by every tile in the grid). */
type MetricStyles = { root: ViewStyle; image: ViewStyle; name: TextStyle; price: TextStyle };
const metricStyleCache = new WeakMap<TileMetrics, MetricStyles>();
function metricStyles(metrics: TileMetrics): MetricStyles {
  let cached = metricStyleCache.get(metrics);
  if (!cached) {
    cached = {
      root: { height: metrics.height },
      image: { height: metrics.imageHeight },
      name: { height: metrics.nameHeight },
      price: { height: metrics.priceHeight },
    };
    metricStyleCache.set(metrics, cached);
  }
  return cached;
}

export const ProductTile = memo(function ProductTile({
  product,
  metrics,
  onPress,
  stock,
  recipeCheck = false,
  showCartQty = false,
}: ProductTileProps) {
  const inCart = useCartStore((state) => (showCartQty ? qtyInCart(state.lines, product.id) : 0));
  const unavailable = !product.is_available;
  const testID = `product-tile-${product.id}`;
  const price = formatPeso(product.price_cents);
  const badge = product.track_stock && !unavailable && stock ? stockBadge(stock.qty, stock.reorderLevel) : null;
  const showRecipeCheck = recipeCheck && !product.track_stock && !unavailable;
  const dimmed = unavailable || badge?.variant === 'cancelled';
  const tint = productTint(product.id);
  const sized = metricStyles(metrics);
  const label =
    `${product.name}, ${price}${unavailable ? ', unavailable' : ''}${badge ? `, ${badge.spoken}` : ''}` +
    `${showRecipeCheck ? ', check stock' : ''}${inCart > 0 ? `, ${inCart} in cart` : ''}`;
  const press = useCallback(() => onPress?.(product), [onPress, product]);

  let chip = null;
  if (unavailable) chip = <Chip label="Unavailable" variant="cancelled" testID={`${testID}-unavailable`} />;
  else if (badge) chip = <Chip label={badge.label} variant={badge.variant} testID={`${testID}-stock`} />;
  else if (showRecipeCheck) chip = <Chip label="Check stock" variant="caution" testID={`${testID}-recipe-check`} />;

  const content = (
    <>
      <View
        style={[styles.image, sized.image, tint.backgroundStyle, dimmed && styles.dimmed]}
        testID={`${testID}-image`}
      >
        <Text style={[styles.initial, tint.inkStyle]} accessibilityElementsHidden importantForAccessibility="no">
          {productInitial(product.name)}
        </Text>
        {product.image_url ? (
          // Drawn over the tinted initial: until it loads (or if it fails) the initial shows.
          <Image
            source={{ uri: product.image_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={String(product.id)}
            transition={motion.imageFadeMs}
            accessible={false}
          />
        ) : null}
        {chip ? <View style={styles.chipSlot}>{chip}</View> : null}
      </View>
      {inCart > 0 ? (
        <View style={styles.qtyBadge} testID={`${testID}-in-cart`}>
          <Text style={styles.qtyText}>{inCart}</Text>
        </View>
      ) : null}
      <View style={[styles.text, dimmed && styles.dimmed]} testID={`${testID}-text`}>
        <Text style={[styles.name, sized.name]} numberOfLines={NAME_LINES}>
          {product.name}
        </Text>
        <Text
          style={[styles.price, sized.price, unavailable && styles.priceUnavailable]}
          numberOfLines={1}
          testID={`${testID}-price`}
        >
          {price}
        </Text>
      </View>
    </>
  );

  return (
    <View style={sized.root} testID={testID}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={unavailable ? undefined : 'Adds one to the cart'}
          accessibilityState={{ disabled: unavailable }}
          disabled={unavailable}
          onPress={press}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          testID={`${testID}-body`}
        >
          {content}
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityLabel={label}
          accessibilityState={{ disabled: unavailable }}
          style={styles.card}
          testID={`${testID}-body`}
        >
          {content}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: PAD_TOP,
    paddingBottom: PAD_BOTTOM,
    paddingHorizontal: spacing.sm,
    gap: IMAGE_GAP,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.primarySoftPressed,
    transform: [{ scale: pressedScale }],
  },
  image: {
    overflow: 'hidden',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    ...typography.titleLarge,
    fontFamily: fontFamilies.heavy,
  },
  chipSlot: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    alignItems: 'flex-start',
  },
  qtyBadge: {
    position: 'absolute',
    top: PAD_TOP + spacing.sm,
    right: spacing.lg,
    minWidth: sizes.chipMinHeight,
    height: sizes.chipMinHeight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    ...typography.captionStrong,
    ...numeric,
    fontFamily: fontFamilies.heavy,
    color: colors.onPrimary,
  },
  text: {
    gap: TEXT_GAP,
    paddingHorizontal: spacing.xs,
  },
  dimmed: {
    opacity: opacity.dimmed,
  },
  name: {
    ...nameText,
    color: colors.text,
  },
  price: {
    ...priceText,
    color: colors.primaryDark,
  },
  priceUnavailable: {
    color: colors.textSecondary,
  },
});
