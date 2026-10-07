import Constants from 'expo-constants';
import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, layout, radius, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

export const APP_NAME = 'POS Mobile';
export const APP_TAGLINE = 'One calm workspace for the counter, the kitchen and the back office.';
export const APP_HEADLINE = 'Serve faster.\nClose every shift clean.';

const APP_VERSION = Constants.expoConfig?.version?.trim() || null;

const FEATURES: readonly { icon: IconName; label: string }[] = [
  { icon: 'cloud-done-outline', label: 'Keeps selling when the internet drops' },
  { icon: 'print-outline', label: 'Receipts and kitchen tickets in one tap' },
  { icon: 'cube-outline', label: 'Stock and ingredients that add up' },
];

/**
 * - `side`: the tall flat dark-emerald panel beside the form (tablet landscape).
 * - `hero`: the stacked header above the form, rounded at the bottom (tablet portrait).
 * - `mark`: the same stacked header, phone-sized (a short brand row on short landscape heights).
 */
export type BrandPanelVariant = 'side' | 'hero' | 'mark';

type BrandPanelProps = {
  variant: BrandPanelVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function BrandTile() {
  return (
    <View style={styles.tile}>
      <Icon name="leaf-outline" size={iconSizes.lg} color={colors.primary} />
    </View>
  );
}

/** The faint oversized leaf outline in the panel's bottom-right corner (decoration only). */
function Leaf({ size }: { size: number }) {
  return (
    <View style={[styles.leaf, { right: -size * 0.28, bottom: -size * 0.25 }]}>
      <Icon name="leaf-outline" size={size} color={colors.onBrandDecoration} />
    </View>
  );
}

/** App branding for the login screen: a flat dark-emerald panel (no gradient), in three responsive variants. */
export const BrandPanel = memo(function BrandPanel({ variant, style, testID }: BrandPanelProps) {
  const { isCompactHeight, isTablet, screenPaddingX } = useResponsive();

  if (variant === 'side') {
    return (
      <View style={[styles.side, style]} testID={testID}>
        <Leaf size={sizes.brandLeaf.side} />
        <View style={styles.brandRow}>
          <BrandTile />
          <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
            {APP_NAME}
          </Text>
        </View>

        <View style={styles.sideBody}>
          <Text style={styles.headline}>{APP_HEADLINE}</Text>
          <Text style={styles.tagline}>{APP_TAGLINE}</Text>
          <View style={styles.features}>
            {FEATURES.map((feature) => (
              <View key={feature.icon} style={styles.feature}>
                <View style={styles.featureTile}>
                  <Icon name={feature.icon} size={iconSizes.sm} color={colors.highlight} />
                </View>
                <Text style={styles.featureText}>{feature.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {APP_VERSION ? <Text style={styles.version}>Version {APP_VERSION}</Text> : <View />}
      </View>
    );
  }

  // Stacked header (phones and tablet portrait). Short landscape heights get a short brand row only.
  const compact = isCompactHeight;
  const minHeight = compact ? undefined : isTablet ? sizes.loginHeader.tablet : sizes.loginHeader.phone;

  return (
    <View
      style={[
        styles.header,
        compact && styles.headerCompact,
        { minHeight, paddingTop: compact ? spacing.lg : spacing.xxxl, paddingHorizontal: screenPaddingX + spacing.xs },
        style,
      ]}
      testID={testID}
    >
      <Leaf size={sizes.brandLeaf.header} />
      {compact ? (
        <View style={styles.brandRow}>
          <BrandTile />
          <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
            {APP_NAME}
          </Text>
        </View>
      ) : (
        <>
          <BrandTile />
          <View style={styles.headerText}>
            <Text style={[styles.headlineCompact, isTablet && styles.headlineTablet]} accessibilityRole="header">
              {APP_HEADLINE}
            </Text>
            <Text style={styles.headerCaption} numberOfLines={2}>
              {variant === 'hero' ? `${APP_NAME} · ${APP_TAGLINE}` : APP_NAME}
            </Text>
          </View>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  side: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.giant,
    paddingTop: spacing.giant,
    paddingBottom: spacing.xxxl,
    justifyContent: 'space-between',
    gap: spacing.xxl,
    overflow: 'hidden',
  },
  leaf: {
    position: 'absolute',
    pointerEvents: 'none',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + spacing.xxs,
  },
  tile: {
    width: sizes.brandTile,
    height: sizes.brandTile,
    borderRadius: radius.cta,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    ...typography.brandName,
    color: colors.onGradient,
    flexShrink: 1,
  },
  sideBody: {
    gap: spacing.xxl,
  },
  headline: {
    ...typography.brandHeadline,
    color: colors.onGradient,
  },
  tagline: {
    ...typography.brandTagline,
    color: colors.onGradientMuted,
    maxWidth: layout.brandTaglineMaxWidth,
  },
  features: {
    gap: spacing.md + spacing.xxs,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureTile: {
    width: sizes.brandFeatureTile,
    height: sizes.brandFeatureTile,
    borderRadius: radius.inner,
    backgroundColor: colors.onBrandTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    ...typography.body,
    color: colors.onGradient,
    flexShrink: 1,
  },
  version: {
    ...typography.captionMedium,
    color: colors.onBrandFaint,
  },
  header: {
    width: '100%',
    backgroundColor: colors.primaryDark,
    borderBottomLeftRadius: radius.header,
    borderBottomRightRadius: radius.header,
    paddingBottom: spacing.xxl + spacing.xs,
    justifyContent: 'space-between',
    gap: spacing.xl,
    overflow: 'hidden',
  },
  headerCompact: {
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerText: {
    gap: spacing.sm,
  },
  headlineCompact: {
    ...typography.brandHeadlineCompact,
    color: colors.onGradient,
  },
  headlineTablet: {
    ...typography.display,
  },
  headerCaption: {
    ...typography.bodySm,
    color: colors.onGradientMuted,
  },
});
