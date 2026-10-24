import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import type { IconName } from '@/components/ui/Icon';
import { spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type FormFooterProps = {
  /** **Cancel** (outline): leaves without saving. Omit to hide it. */
  onCancel?: () => void;
  cancelDisabled?: boolean;
  /** **Save** (green pill). */
  saveTitle: string;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveIcon?: IconName;
  saveTestID?: string;
  /** A destructive save (e.g. a refund): the filled destructive button instead of the green pill. */
  destructive?: boolean;
  cancelTestID?: string;
  /** Extra actions on the left (e.g. a destructive outline button). */
  children?: ReactNode;
};

/**
 * The sticky footer of a create / edit form (back-office.md → Forms):
 * **Cancel** (outline) and **Save** (green pill), right-aligned on tablets and
 * full-width on phones in portrait. Pass it to `FormLayout`'s `footer`.
 */
export function FormFooter({
  onCancel,
  cancelDisabled = false,
  saveTitle,
  onSave,
  saving = false,
  saveDisabled = false,
  saveIcon = 'checkmark',
  destructive = false,
  saveTestID,
  cancelTestID = 'form-cancel',
  children,
}: FormFooterProps) {
  const { isPhone, isPortrait } = useResponsive();
  const stacked = isPhone && isPortrait;
  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      {children ? <View style={[styles.extra, stacked && styles.full]}>{children}</View> : null}
      {onCancel ? (
        <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={cancelDisabled} style={stacked ? styles.full : null} testID={cancelTestID} />
      ) : null}
      <Button
        title={saveTitle}
        leftIcon={saveIcon}
        variant={destructive ? 'destructive' : 'primary'}
        onPress={onSave}
        loading={saving}
        disabled={saveDisabled}
        style={stacked ? styles.full : styles.save}
        testID={saveTestID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  rowStacked: {
    flexDirection: 'column-reverse',
    alignItems: 'stretch',
  },
  extra: {
    marginRight: 'auto',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  full: {
    width: '100%',
  },
  save: {
    minWidth: spacing.huge * 4,
  },
});
