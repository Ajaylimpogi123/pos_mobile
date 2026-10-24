import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { gradients, radius } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type HeaderBandProps = {
  /** E.g. horizontal insets so the band's rounded corners show. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The decorative header band (MASTER §1.2 / §2.3 / §6): the green 135°
 * gradient, absolutely positioned at the top of its container, 200 dp tall on
 * tablets and 120 below 600 dp of height (`useResponsive().bandHeight`), with
 * a 6 px radius. It never carries meaning: hidden from screen readers and
 * never touchable. Content drawn after it in the tree (cards) overlaps it.
 * White text goes only over its left, darker part (see `ListHeader`'s `band`).
 */
export function HeaderBand({ style, testID = 'header-band' }: HeaderBandProps) {
  const { bandHeight } = useResponsive();
  return (
    <LinearGradient
      colors={gradients.band.colors}
      locations={gradients.band.locations}
      start={gradients.band.start}
      end={gradients.band.end}
      style={[styles.band, { height: bandHeight }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderRadius: radius.band,
  },
});
