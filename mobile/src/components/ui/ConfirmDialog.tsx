import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button, type ButtonVariant } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import type { IconName } from '@/components/ui/Icon';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  icon?: IconName;
  /** Shows a spinner on the confirm button and blocks both buttons. */
  busy?: boolean;
  /** Blocks the confirm button (e.g. an empty required input). */
  confirmDisabled?: boolean;
  /** A non-field error shown inside the dialog. */
  error?: string | null;
  /** Extra content between the message and the buttons, e.g. an input. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

/**
 * Themed confirmation modal for destructive or important actions (a `danger`
 * confirm is drawn as the filled destructive button), and small
 * one-input forms (children). Buttons sit side by side, and stack (confirm on
 * top) on small phones. The dialog scrolls if a short landscape screen can't fit it.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  icon,
  busy = false,
  confirmDisabled = false,
  error,
  children,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  const { isSmallPhone, isCompactHeight } = useResponsive();
  const stacked = isSmallPhone;
  // MASTER §3: a destructive confirmation uses the filled destructive button (the label names the action).
  const destructive = confirmVariant === 'danger' || confirmVariant === 'destructive';
  const variant: ButtonVariant = destructive ? 'destructive' : confirmVariant;

  return (
    <DialogFrame visible={visible} onRequestClose={onCancel} busy={busy} testID={testID}>
      {icon && !isCompactHeight ? <IconBadge icon={icon} tone={destructive ? 'danger' : 'primary'} /> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Banner message={error} testID={testID ? `${testID}-error` : undefined} /> : null}
      {children}
      <View style={[styles.actions, stacked && styles.actionsStacked]}>
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
          variant={variant}
          onPress={onConfirm}
          loading={busy}
          disabled={confirmDisabled}
          style={styles.action}
          testID={testID ? `${testID}-confirm` : undefined}
        />
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
