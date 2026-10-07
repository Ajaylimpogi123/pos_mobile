import { StyleSheet, Text, View } from 'react-native';

import { ShiftPrintStatus } from '@/components/shifts/ShiftPrintStatus';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconBadge } from '@/components/ui/IconBadge';
import { Input } from '@/components/ui/Input';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, spacing, typography } from '@/constants/theme';
import type { ShiftControls } from '@/hooks/shifts/useShiftControls';
import { useResponsive } from '@/hooks/useResponsive';

type OpenShiftGateProps = {
  controls: ShiftControls;
};

/** Shown to someone who can sell but not open a shift. */
export const NO_SHIFT_PERMISSION_MESSAGE =
  'Sales need an open shift on this tablet. Ask someone who can open shifts (for example a cashier or a manager) to open one.';

/**
 * The Sell screen's shift gate (docs/api-contract.md → Shifts & Reporting →
 * Shift gate): **Open a shift** with the starting cash (`shift.open`) when
 * this tablet has no open shift, since sales need one. After a close it also
 * shows the Z-read's print status. A centred card (max ≈480) that scrolls,
 * with the input kept above the keyboard. Works offline.
 */
export function OpenShiftGate({ controls }: OpenShiftGateProps) {
  const { formMaxWidth, screenPaddingX, screenPaddingY, gutter, cardPadding, isCompactHeight } = useResponsive();
  const { current, open } = controls;

  if (current.loading) return <LoadingState message="Checking this tablet's shift…" testID="shift-gate-loading" />;
  if (current.error) {
    return <ErrorState title="Couldn't read the shift" message={current.error} onRetry={current.reload} testID="shift-gate-error" />;
  }

  return (
    <KeyboardScrollView
      contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }}
      testID="shift-gate"
    >
      <View style={[styles.inner, { maxWidth: formMaxWidth, gap: gutter }]}>
        {controls.lastClose ? (
          <Card style={styles.card} testID="shift-closed-card">
            <Banner variant="success" message="Shift closed. The Z-read was sent to the receipt printer." testID="shift-closed" />
            <ShiftPrintStatus jobIds={controls.lastClose.jobIds} notice={controls.lastClose.notice} testID="z-read-status" />
          </Card>
        ) : null}
        {controls.gateNotice ? <Banner variant="warning" message={controls.gateNotice} testID="shift-gate-notice" /> : null}

        <Card style={[styles.card, { padding: cardPadding }]} testID="open-shift-card">
          {isCompactHeight ? null : <IconBadge icon="time-outline" size="lg" />}
          <Text style={styles.title} accessibilityRole="header">
            Open a shift
          </Text>
          {controls.canOpen ? (
            <>
              <Text style={styles.message}>
                Count the cash in the drawer and enter it as the starting cash. Sales need an open shift on this tablet.
              </Text>
              {open.bannerError ? <Banner message={open.bannerError} testID="open-shift-error" /> : null}
              <Input
                label="Starting cash"
                prefix="₱"
                value={open.amount}
                onChangeText={open.setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                error={open.error}
                editable={!controls.busy}
                returnKeyType="done"
                onSubmitEditing={open.submit}
                testID="open-shift-amount"
              />
              <Button
                title="Open shift"
                leftIcon="play-circle-outline"
                size="lg"
                onPress={open.submit}
                loading={controls.busy}
                testID="open-shift-submit"
              />
            </>
          ) : (
            <Text style={styles.message} testID="open-shift-no-permission">
              {NO_SHIFT_PERMISSION_MESSAGE}
            </Text>
          )}
        </Card>
      </View>
    </KeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  inner: {
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
