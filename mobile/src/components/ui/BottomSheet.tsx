import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SUPPORTED_ORIENTATIONS } from '@/components/ui/DialogFrame';
import { colors, layout, radius, shadows, sizes, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Screen-reader label of the dimmed backdrop, which closes the sheet. */
  closeLabel: string;
  children: ReactNode;
  testID?: string;
};

/**
 * A sheet that slides up from the bottom over a dimmed backdrop (tapping the
 * backdrop or pressing Back closes it). White, with large top corners, a
 * grab handle, at most `layout.cartSheetMaxHeight` of the window, centred
 * and capped at the content width on wide screens. It pads the bottom,
 * left and right safe areas; its content decides what scrolls.
 */
export function BottomSheet({ visible, onClose, closeLabel, children, testID }: BottomSheetProps) {
  const { contentMaxWidth } = useResponsive();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      supportedOrientations={[...SUPPORTED_ORIENTATIONS]}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <SafeAreaView
          edges={['left', 'right', 'bottom']}
          style={[styles.sheet, { maxHeight: layout.cartSheetMaxHeight, maxWidth: contentMaxWidth }]}
          accessibilityViewIsModal
          testID={testID}
        >
          <View style={styles.handle} />
          {children}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    ...shadows.lg,
  },
  handle: {
    alignSelf: 'center',
    width: sizes.sheetHandle.width,
    height: sizes.sheetHandle.height,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.xs,
  },
});
