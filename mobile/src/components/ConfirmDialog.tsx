import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button, type ButtonVariant } from '@/components/Button';
import { colors, fontSizes, fontWeights, radii, shadows, sizes, spacing } from '@/constants/theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  /** Shows a spinner on the confirm button and blocks both buttons. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

/** Themed confirmation modal for destructive or important actions. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={['landscape', 'portrait']}
      onRequestClose={busy ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog} testID={testID} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Button
              title={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              disabled={busy}
              style={styles.action}
              testID={testID ? `${testID}-cancel` : undefined}
            />
            <Button
              title={confirmLabel}
              variant={confirmVariant}
              onPress={onConfirm}
              loading={busy}
              style={styles.action}
              testID={testID ? `${testID}-confirm` : undefined}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: sizes.dialogMaxWidth,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.lg,
    ...shadows.card,
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  message: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  action: {
    flex: 1,
  },
});
