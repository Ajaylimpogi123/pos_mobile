import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BANNER_PALETTES } from '@/components/ui/Banner';
import { Icon, type IconName } from '@/components/ui/Icon';
import { layout, motion, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useResponsive } from '@/hooks/useResponsive';
import { useToastStore, type ToastMessage, type ToastVariant } from '@/stores/toast';

const LOOKS: Record<ToastVariant, { palette: (typeof BANNER_PALETTES)['success']; glyph: IconName }> = {
  success: { palette: BANNER_PALETTES.success, glyph: 'checkmark-circle' },
  error: { palette: BANNER_PALETTES.error, glyph: 'alert-circle' },
  info: { palette: BANNER_PALETTES.info, glyph: 'information-circle' },
};

/** One toast: fades in, stays `motion.toastVisibleMs`, fades out (no fade under reduce-motion). Tap to dismiss. */
function ToastCard({ toast }: { toast: ToastMessage }) {
  const hide = useToastStore((state) => state.hide);
  const reduceMotion = useReducedMotion();
  const [fade] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const look = LOOKS[toast.variant];

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(toast.message);
    if (!reduceMotion) {
      Animated.timing(fade, { toValue: 1, duration: motion.toastMs, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }
    const timer = setTimeout(() => hide(toast.id), motion.toastVisibleMs);
    return () => clearTimeout(timer);
  }, [toast, hide, fade, reduceMotion]);

  return (
    <Animated.View style={[styles.slot, { opacity: fade }]}>
      <Pressable
        accessibilityRole={toast.variant === 'error' ? 'alert' : 'text'}
        accessibilityLiveRegion="polite"
        accessibilityHint="Dismisses the message"
        onPress={() => hide(toast.id)}
        style={[styles.toast, { backgroundColor: look.palette.background, borderColor: look.palette.border }]}
        testID={`toast-${toast.variant}`}
      >
        <Icon name={look.glyph} size={sizes.toastIcon} color={look.palette.icon} />
        <Text style={[styles.text, { color: look.palette.text }]} testID="toast-message">
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Where the current toast is drawn: at the top of the window (tablet), below the safe area. */
export function ToastHost() {
  const toast = useToastStore((state) => state.toast);
  const insets = useSafeAreaInsets();
  const { screenPaddingX } = useResponsive();
  if (!toast) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { paddingTop: insets.top + spacing.sm, paddingHorizontal: screenPaddingX + Math.max(insets.left, insets.right) }]}
      testID="toast-host"
    >
      <ToastCard key={toast.id} toast={toast} />
    </View>
  );
}

/** Renders the app and the toast host above it. Mounted once in `app/_layout.tsx`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <View style={styles.fill}>
      {children}
      <ToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  slot: {
    width: '100%',
    maxWidth: layout.toastMaxWidth,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.iconButton.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    ...shadows.lg,
  },
  text: {
    ...typography.label,
    flex: 1,
  },
});

/** Re-exported for screens: `showToast('Saved')`. */
export { showToast } from '@/stores/toast';
