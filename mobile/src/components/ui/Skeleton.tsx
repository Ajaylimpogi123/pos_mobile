import { memo, useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { colors, motion, opacity, radius as radii, sizes } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type SkeletonProps = {
  /** Width of the block (default: the full width). */
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** A static placeholder block (soft grey-green). Put blocks inside a `SkeletonPulse` to animate them together. */
export const Skeleton = memo(function Skeleton({ width = '100%', height = sizes.skeleton.line, radius = radii.sm, style }: SkeletonProps) {
  return <View style={[styles.block, { width, height, borderRadius: radius }, style]} />;
});

type SkeletonPulseProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * A container whose opacity pulses gently (one loop for the whole group, on
 * the native driver, so it never costs JS frames; still under reduce-motion). Its children are static
 * `Skeleton` blocks.
 */
export function SkeletonPulse({ children, style }: SkeletonPulseProps) {
  const [pulse] = useState(() => new Animated.Value(opacity.skeletonHigh));
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // MASTER §1.7: no pulse under reduce-motion (the blocks stay still).
    if (reduceMotion) {
      pulse.setValue(opacity.skeletonHigh);
      return undefined;
    }
    const half = { duration: motion.skeletonPulseMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true };
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { ...half, toValue: opacity.skeletonLow }),
        Animated.timing(pulse, { ...half, toValue: opacity.skeletonHigh }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return <Animated.View style={[style, { opacity: pulse }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.surfaceMuted,
  },
});
