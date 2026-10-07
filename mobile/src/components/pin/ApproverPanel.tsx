import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PinPad } from '@/components/ui/PinPad';
import { colors, hitTarget, iconSizes, radius, sizes, spacing, typography } from '@/constants/theme';
import { getErrorMessage } from '@/services/api';
import type { PinUser } from '@/services/types';

/** The picker's state (checkout's discount approval and the void / refund approval share it). */
export type ApproverPanelState = {
  step: 'pick' | 'pin';
  approver: PinUser | null;
  pin: string;
  error: string | null;
};

type ApproverPanelProps = {
  approval: ApproverPanelState;
  /** The people who may approve (already filtered). */
  approvers: readonly PinUser[];
  loading: boolean;
  /** `pin-users` couldn't load. */
  loadError: unknown;
  onRetry: () => void;
  onChoose: (person: PinUser) => void;
  onBack: () => void;
  onPinChange: (pin: string) => void;
  /** A request is in flight. */
  disabled: boolean;
  /** Shown when nobody can approve. */
  emptyText: string;
  /** Test IDs: `<prefix>-approver`, `<prefix>-pin`, `<prefix>-error`, …; the rows are `approver-<id>`. */
  testIDPrefix: string;
};

/**
 * A manager's approval on the same screen: pick an approver (from
 * `pin-users`), then their PIN on the pad. Used by checkout's discount
 * approval and by voids and refunds (Phase 7).
 */
export function ApproverPanel({
  approval,
  approvers,
  loading,
  loadError,
  onRetry,
  onChoose,
  onBack,
  onPinChange,
  disabled,
  emptyText,
  testIDPrefix,
}: ApproverPanelProps) {
  if (approval.step === 'pin' && approval.approver) {
    const approver = approval.approver;
    return (
      <View style={styles.list}>
        <View style={styles.approverRow}>
          <Text style={styles.approverName} numberOfLines={1} testID={`${testIDPrefix}-approver`}>
            {approver.name}
          </Text>
          <Button title="Change" variant="ghost" onPress={onBack} disabled={disabled} testID={`${testIDPrefix}-change-approver`} />
        </View>
        <PinPad
          value={approval.pin}
          onChange={onPinChange}
          accessibilityLabel={`PIN for ${approver.name}`}
          disabled={disabled}
          error={approval.error}
          testID={`${testIDPrefix}-pin`}
        />
      </View>
    );
  }
  if (loading) return <ActivityIndicator color={colors.primaryBright} style={styles.spinner} testID={`${testIDPrefix}-loading`} />;
  if (loadError) {
    return (
      <View style={styles.list}>
        <Banner message={getErrorMessage(loadError)} testID={`${testIDPrefix}-list-error`} />
        <Button title="Retry" leftIcon="refresh" variant="secondary" onPress={onRetry} testID={`${testIDPrefix}-list-retry`} />
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {approval.error ? <Banner message={approval.error} testID={`${testIDPrefix}-error`} /> : null}
      {approvers.length === 0 ? (
        <Text style={styles.empty} testID={`${testIDPrefix}-none`}>
          {emptyText}
        </Text>
      ) : (
        approvers.map((person, index) => (
          <Pressable
            key={person.id}
            accessibilityRole="button"
            accessibilityLabel={`${person.name}, ${person.role.name}`}
            accessibilityHint="Enter their PIN next"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onChoose(person)}
            testID={`approver-${person.id}`}
            style={({ pressed }) => [styles.person, index > 0 && styles.divider, pressed && styles.pressed]}
          >
            <Icon name="person-circle-outline" size={iconSizes.lg} color={colors.primary} />
            <View style={styles.personText}>
              <Text style={styles.personName} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={styles.personRole} numberOfLines={1}>
                {person.role.name}
              </Text>
            </View>
            <Icon name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} />
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  spinner: {
    marginVertical: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  divider: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  personText: {
    flex: 1,
    gap: spacing.xxs,
  },
  personName: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  personRole: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  approverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  approverName: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
});
