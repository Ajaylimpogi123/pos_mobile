import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { colors, layout, radius, shadows, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type DialogFrameProps = {
  visible: boolean;
  /** Back button / swipe: called unless the dialog is busy. */
  onRequestClose: () => void;
  busy?: boolean;
  children: ReactNode;
  testID?: string;
};

/** Every orientation, so an open dialog never forces or blocks a rotation. */
export const SUPPORTED_ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'] as const;

/**
 * The shared modal shell for dialogs (MASTER §3): a 50 % black backdrop and a
 * centred white card (max 440 wide, radius 16). It scrolls when a short landscape
 * screen can't fit it, and a KeyboardAvoidingView keeps inputs above the
 * keyboard (`padding` on iOS; Android resizes the window itself).
 */
export function DialogFrame({ visible, onRequestClose, busy = false, children, testID }: DialogFrameProps) {
  const { screenPaddingX, screenPaddingY, cardPadding } = useResponsive();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={[...SUPPORTED_ORIENTATIONS]}
      onRequestClose={busy ? undefined : onRequestClose}
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.backdrop}
          contentContainerStyle={[styles.backdropContent, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.dialog, { padding: cardPadding }]} testID={testID} accessibilityViewIsModal>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  backdropContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: '100%',
    maxWidth: layout.dialogMaxWidth,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    gap: spacing.md,
    ...shadows.lg,
  },
});
