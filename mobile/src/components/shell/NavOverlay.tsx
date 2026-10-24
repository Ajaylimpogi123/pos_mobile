import { useEffect, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet } from 'react-native';

import { motion, sidebar } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type NavOverlayProps = {
  visible: boolean;
  onClose: () => void;
  /** Width of the sliding panel area (including its margins). */
  width: number;
  children: ReactNode;
  testID?: string;
};

/**
 * A panel that slides in from the left over the content, with a scrim.
 * Tapping the scrim or pressing Back (Android) closes it. It stays mounted
 * while the slide-out runs, then unmounts. Uses React Native's Animated with
 * the native driver (transform + opacity only), so the slide stays smooth.
 */
export function NavOverlay({ visible, onClose, width, children, testID = 'nav-overlay' }: NavOverlayProps) {
  const [progress] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  const reduceMotion = useReducedMotion();

  // Mount as soon as it should show (state derived during render, not in an effect).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted) return;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      // MASTER §1.7: no slide under reduce-motion.
      duration: reduceMotion ? 0 : motion.drawerMs,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, mounted, progress, reduceMotion]);

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  if (!mounted) return null;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'} testID={testID}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          onPress={onClose}
          testID={`${testID}-scrim`}
        />
      </Animated.View>
      <Animated.View
        style={[styles.panel, { width, transform: [{ translateX }] }]}
        accessibilityViewIsModal
        testID={`${testID}-panel`}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: sidebar.colors.scrim,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
});
