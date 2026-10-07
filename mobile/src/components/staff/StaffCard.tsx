import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, iconSizes, pressedScale, spacing, typography } from '@/constants/theme';
import type { StaffUser } from '@/services/types';
import { formatLastLogin } from '@/utils/dates';

type StaffCardProps = {
  user: StaffUser;
  /** The signed-in user's own record: shows a "You" badge. */
  isSelf: boolean;
  /** Stable handler (it receives the user), so the memoized card only re-renders when its data changes. */
  onPress: (user: StaffUser) => void;
};

/**
 * Staff list card: name, email, role chip, Active/Inactive pill, PIN status,
 * last login ("Never" when null) and a "You" badge on your own record.
 * - `can_manage: true`: a pencil affordance; tapping opens the edit screen.
 * - `can_manage: false`: muted, with a lock icon and no edit affordance;
 *   tapping opens a read-only view.
 */
export const StaffCard = memo(function StaffCard({ user, isSelf, onPress }: StaffCardProps) {
  const testID = `staff-card-${user.id}`;
  const locked = !user.can_manage;
  const lastLogin = formatLastLogin(user.last_login_at);

  const label = [
    user.name,
    isSelf ? 'you' : null,
    user.role.name,
    user.is_active ? 'active' : 'inactive',
    user.has_pin ? 'PIN set' : 'no PIN',
    `last login ${lastLogin}`,
    locked ? 'view only' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card style={[styles.card, locked && styles.cardLocked]} elevation={locked ? 'sm' : 'md'} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={locked ? 'Opens the staff member, view only' : 'Opens the staff member to edit'}
        onPress={() => onPress(user)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.titleRow}>
          <IconBadge icon={locked ? 'lock-closed-outline' : 'person-outline'} tone={locked ? 'info' : 'primary'} />
          <View style={styles.titleText}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, locked && styles.mutedText]} numberOfLines={2}>
                {user.name}
              </Text>
              {isSelf ? <Chip label="You" variant="primary" icon="person-circle-outline" testID={`${testID}-you`} /> : null}
            </View>
            <Text style={styles.email} numberOfLines={1}>
              {user.email}
            </Text>
          </View>
          {locked ? (
            <View testID={`${testID}-locked`}>
              <Icon name="lock-closed" size={iconSizes.md} color={colors.textSecondary} />
            </View>
          ) : (
            <View testID={`${testID}-edit`}>
              <Icon name="create-outline" size={iconSizes.md} color={colors.primary} />
            </View>
          )}
        </View>

        <View style={styles.chips}>
          <Chip label={user.role.name} variant="primary" icon="shield-checkmark-outline" testID={`${testID}-role`} />
          <Chip
            label={user.is_active ? 'Active' : 'Inactive'}
            variant={user.is_active ? 'completed' : 'neutral'}
            testID={`${testID}-status`}
          />
          <Chip
            label={user.has_pin ? 'PIN set' : 'No PIN'}
            variant={user.has_pin ? 'neutral' : 'caution'}
            icon="keypad-outline"
            testID={`${testID}-pin`}
          />
        </View>

        <View style={styles.meta}>
          <Icon name="time-outline" size={iconSizes.sm} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1} testID={`${testID}-last-login`}>
            Last login: {lastLogin}
          </Text>
        </View>
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
  },
  cardLocked: {
    backgroundColor: colors.surfaceMuted,
  },
  body: {
    gap: spacing.md,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  titleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  mutedText: {
    color: colors.textSecondary,
  },
  email: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    ...typography.label,
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
