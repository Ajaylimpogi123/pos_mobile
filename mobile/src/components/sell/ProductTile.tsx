import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { stockBadge } from '@/components/inventory/inventoryLabels';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import {
  colors,
  fontFamilies,
  iconSizes,
  motion,
  numeric,
  opacity,
  pressedScale,
  radius,
  shadows,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { MenuProduct } from '@/db/menuQueries';
import type { CachedStockBadge } from '@/db/offlineRepository';
import { useCartStoreApi, type CartLine } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';

// Card anatomy (MASTER §3 product card): 14 padding, the image area, a 10 gap,
// a 2-line name (16 / 700), a 4 gap, the price (16 / 700, green), a 10 gap and
// the full-width 40 dp "+ Add" pill. Every part has a fixed height, so all
// cards are the same height and the grid can use `getItemLayout` (no
// measuring while scrolling).
const PAD = spacing.md + spacing.xxs;
const IMAGE_GAP = spacing.sm + spacing.xxs;
const TEXT_GAP = spacing.xs;
const NAME_LINES = 2;
const nameText = typography.productName;
const priceText = typography.productPrice;

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
    height: 2 * sizes.borderWidth + 2 * PAD + imageHeight + IMAGE_GAP + nameHeight + TEXT_GAP + priceHeight + IMAGE_GAP + sizes.tileAddButton,
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
  /**
   * Users with a cart: a tap adds one (the whole card is the **+ Add** button).
   * Return `false` when nothing was added (e.g. the 100-line limit), so the
   * card doesn't say "Added". Without it the card is read-only (the Phase 2 screen).
   */
  onPress?: (product: MenuProduct) => boolean | void;
  /** The cached level of a `track_stock` product (Inventory → Sell tile badges); `undefined`: none cached. */
  stock?: CachedStockBadge;
  /** §J: a recipe product with a component out (cached `/sync/stock` `recipes[].status = check`). */
  recipeCheck?: boolean;
  /** Phones and portrait (the cart is behind a bar): show how many are in the cart. */
  showCartQty?: boolean;
};

/**
 * A Sell-screen product card (MASTER §3, sell.md): a white card (radius 12,
 * hairline border, 14 padding); the square-cornered image, or a #F3F4F6
 * placeholder with a utensils icon; a stock badge top-right (`Unavailable`,
 * `Out`, `Low · 3 left`, `Check stock`); the name (16 / 700) and the price
 * (16 / 700, green); then the full-width **+ Add** pill. On phones a round
 * badge top-left shows how many are in the cart.
 *
 * The whole card is one button (a large target); the pill shows the action:
 * a tap adds one, and the pill reads "Added ✓" for about a second.
 * - Unavailable (`is_available: false`) is the only disabled state: a red
 *   badge, a dimmed image and a disabled **Unavailable** pill.
 * - Out of stock is advisory (MASTER §6): the red badge, but the card stays
 *   tappable (online the server checks; offline sales never block).
 * - §J: `Check stock` (a recipe component is out) is an amber badge, sellable.
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
  const useCartStore = useCartStoreApi();
  const inCart = useCartStore((state) => (showCartQty ? qtyInCart(state.lines, product.id) : 0));
  const unavailable = !product.is_available;
  const testID = `product-tile-${product.id}`;
  const price = formatPeso(product.price_cents);
  const badge = product.track_stock && !unavailable && stock ? stockBadge(stock.qty, stock.reorderLevel) : null;
  const showRecipeCheck = recipeCheck && !product.track_stock && !unavailable;
  const sized = metricStyles(metrics);
  const reduceMotion = useReducedMotion();
  // "Added ✓" for a moment after a tap that added.
  const [addedAt, setAddedAt] = useState(0);
  useEffect(() => {
    if (addedAt === 0) return undefined;
    const timer = setTimeout(() => setAddedAt(0), motion.addedMs);
    return () => clearTimeout(timer);
  }, [addedAt]);
  const label =
    `${product.name}, ${price}${unavailable ? ', unavailable' : ''}${badge ? `, ${badge.spoken}` : ''}` +
    `${showRecipeCheck ? ', check stock' : ''}${inCart > 0 ? `, ${inCart} in cart` : ''}`;
  const press = useCallback(() => {
    if (onPress?.(product) !== false) setAddedAt(Date.now());
  }, [onPress, product]);
  const added = addedAt !== 0;

  let chip = null;
  if (unavailable) chip = <Chip label="Unavailable" variant="cancelled" testID={`${testID}-unavailable`} />;
  else if (badge) chip = <Chip label={badge.label} variant={badge.variant} testID={`${testID}-stock`} />;
  else if (showRecipeCheck) chip = <Chip label="Check stock" variant="caution" testID={`${testID}-recipe-check`} />;

  const content = (
    <>
      <View style={[styles.image, sized.image, unavailable && styles.dimmed]} testID={`${testID}-image`}>
        <Icon name="restaurant-outline" size={iconSizes.xl} color={colors.textMuted} />
        {product.image_url ? (
          // Drawn over the placeholder: until it loads (or if it fails) the utensils icon shows.
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
      <View style={[styles.text, unavailable && styles.dimmed]} testID={`${testID}-text`}>
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

  const pill = (pressed: boolean) => {
    let look: ViewStyle = styles.addPill;
    let text = '+ Add';
    if (unavailable) {
      look = styles.addPillDisabled;
      text = 'Unavailable';
    } else if (pressed) look = styles.addPillPressed;
    if (added && !unavailable) text = 'Added ✓';
    return (
      <View style={[styles.addPillBase, look]} testID={`${testID}-add`}>
        <Text style={[styles.addText, unavailable && styles.addTextDisabled]} numberOfLines={1}>
          {text}
        </Text>
      </View>
    );
  };

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
          style={({ pressed }) => [styles.card, pressed && styles.pressed, pressed && !reduceMotion && styles.pressedScale]}
          testID={`${testID}-body`}
        >
          {({ pressed }) => (
            <>
              {content}
              {pill(pressed)}
            </>
          )}
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
    padding: PAD,
    gap: IMAGE_GAP,
    ...shadows.sm,
  },
  pressed: {
    borderColor: colors.greenLine,
  },
  pressedScale: {
    transform: [{ scale: pressedScale }],
  },
  image: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.imageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSlot: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    alignItems: 'flex-end',
  },
  qtyBadge: {
    position: 'absolute',
    top: PAD + spacing.sm,
    left: PAD + spacing.sm,
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
  },
  dimmed: {
    opacity: opacity.dimmed,
  },
  name: {
    ...nameText,
    color: colors.productName,
  },
  price: {
    ...priceText,
    color: colors.green,
  },
  addPillBase: {
    height: sizes.tileAddButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  addPill: {
    backgroundColor: colors.green,
  },
  addPillPressed: {
    backgroundColor: colors.greenHover,
  },
  addPillDisabled: {
    backgroundColor: colors.disabled,
  },
  addText: {
    ...typography.button,
    color: colors.onPrimary,
  },
  addTextDisabled: {
    color: colors.onDisabled,
  },
  priceUnavailable: {
    color: colors.textSecondary,
  },
});
