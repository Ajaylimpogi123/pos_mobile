import { ActivityIndicator, StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { Skeleton, SkeletonPulse } from '@/components/ui/Skeleton';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type LoadingStateProps = {
  message?: string;
  /**
   * `spinner`: a centred spinner and the message (session restore, single records).
   * `list`: skeleton rows. `grid`: skeleton cards in the current column count.
   * Skeleton variants keep the message as the accessibility label.
   */
  variant?: 'spinner' | 'list' | 'grid';
  testID?: string;
};

const LIST_ROWS = 6;
const GRID_ROWS = 2;

function SkeletonCard({ height }: { height: number }) {
  return (
    <View style={[styles.card, { minHeight: height }]}>
      <Skeleton width="55%" height={sizes.skeleton.lineLarge} />
      <Skeleton width="35%" />
    </View>
  );
}

/** Full-area loading state for first loads: skeleton rows / cards for lists and grids, else a spinner. */
export function LoadingState({ message = 'Loading…', variant = 'spinner', testID }: LoadingStateProps) {
  const { screenPaddingX, screenPaddingY, gutter, columns, contentMaxWidth } = useResponsive();

  if (variant !== 'spinner') {
    const grid = variant === 'grid';
    const count = grid ? columns * GRID_ROWS : LIST_ROWS;
    const cellWidth: DimensionValue = grid && columns > 1 ? `${100 / columns}%` : '100%';
    return (
      <View
        style={[styles.skeletonContainer, { paddingHorizontal: screenPaddingX - gutter / 2, paddingVertical: screenPaddingY - gutter / 2 }]}
        testID={testID}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={message}
      >
        <SkeletonPulse style={[styles.skeletonGrid, { maxWidth: contentMaxWidth + gutter }]}>
          {Array.from({ length: count }, (_unused, index) => (
            <View key={index} style={{ width: cellWidth, padding: gutter / 2 }}>
              <SkeletonCard height={grid ? sizes.skeleton.tile : sizes.skeleton.row} />
            </View>
          ))}
        </SkeletonPulse>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <View style={styles.badge}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  badge: {
    width: sizes.badge.lg,
    height: sizes.badge.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  skeletonContainer: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  skeletonGrid: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
