import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, iconSizes, pressedScale, spacing, typography } from '@/constants/theme';
import type { Customer } from '@/services/types';

type CustomerCardProps = {
  customer: Customer;
  /** Stable handler (it receives the customer), so the memoized card only re-renders when its data changes. */
  onPress: (customer: Customer) => void;
};

function MetaLine({ icon, text, lines = 1, testID }: { icon: IconName; text: string; lines?: number; testID?: string }) {
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={iconSizes.sm} color={colors.textSecondary} />
      <Text style={styles.metaText} numberOfLines={lines} ellipsizeMode="tail" testID={testID}>
        {text}
      </Text>
    </View>
  );
}

/** Customer card: full name, contact, email and a two-line notes preview. Tap to open. */
export const CustomerCard = memo(function CustomerCard({ customer, onPress }: CustomerCardProps) {
  const testID = `customer-card-${customer.id}`;
  const label = [customer.full_name, customer.contact, customer.email].filter(Boolean).join(', ');

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the customer"
        onPress={() => onPress(customer)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.titleRow}>
          <IconBadge icon="person-outline" />
          <Text style={styles.name} numberOfLines={2}>
            {customer.full_name}
          </Text>
        </View>
        {customer.contact ? <MetaLine icon="call-outline" text={customer.contact} testID={`${testID}-contact`} /> : null}
        {customer.email ? <MetaLine icon="mail-outline" text={customer.email} testID={`${testID}-email`} /> : null}
        {customer.notes ? (
          <MetaLine icon="document-text-outline" text={customer.notes} lines={2} testID={`${testID}-notes`} />
        ) : null}
        {!customer.contact && !customer.email && !customer.notes ? (
          <Text style={styles.empty}>No contact details</Text>
        ) : null}
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
  },
  body: {
    gap: spacing.sm,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  name: {
    ...typography.heading,
    color: colors.text,
    flex: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  metaText: {
    ...typography.bodySm,
    color: colors.textSecondary,
    flex: 1,
  },
  empty: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
