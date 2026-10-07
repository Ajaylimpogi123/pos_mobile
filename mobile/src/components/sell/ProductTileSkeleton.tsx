import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { TILE_IMAGE_HEIGHT, tileMetrics } from '@/components/sell/ProductTile';
import { Skeleton, SkeletonPulse } from '@/components/ui/Skeleton';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type ProductTileSkeletonProps = {
  columns: number;
  /** The accessibility label; shown as a caption too when `showMessage` (e.g. the first download). */
  message: string;
  showMessage?: boolean;
  testID?: string;
};

const ROWS = 3;

/**
 * The menu's first load: placeholder tiles the size of the real ones, in the
 * same columns, pulsing on the native driver (no JS frames). Clipped to the area.
 */
export function ProductTileSkeleton({ columns, message, showMessage = false, testID }: ProductTileSkeletonProps) {
  const { screenPaddingX, isPhone } = useResponsive();
  const { fontScale } = useWindowDimensions();
  const metrics = tileMetrics(isPhone ? TILE_IMAGE_HEIGHT.compact : TILE_IMAGE_HEIGHT.regular, fontScale);

  return (
    <View
      style={[styles.container, { paddingHorizontal: screenPaddingX }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      testID={testID}
    >
      {showMessage ? <Text style={styles.message}>{message}</Text> : null}
      <SkeletonPulse style={styles.rows}>
        {Array.from({ length: ROWS }, (_row, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: columns }, (_cell, cell) => (
              <View key={cell} style={[styles.tile, { height: metrics.height }]}>
                <Skeleton height={metrics.imageHeight} radius={radius.md} />
                <View style={styles.text}>
                  <Skeleton width="75%" height={sizes.skeleton.line} />
                  <Skeleton width="40%" height={sizes.skeleton.lineLarge} />
                </View>
              </View>
            ))}
          </View>
        ))}
      </SkeletonPulse>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    paddingTop: spacing.xs,
    gap: spacing.md,
  },
  message: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  rows: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tile: {
    flex: 1,
    padding: spacing.sm,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
