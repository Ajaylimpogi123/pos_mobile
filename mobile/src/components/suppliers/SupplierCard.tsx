import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, iconSizes, pressedScale, spacing, typography } from '@/constants/theme';
import type { Supplier } from '@/services/types';

function MetaLine({ icon, text, testID }: { icon: IconName; text: string; testID: string }) {
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={iconSizes.sm} color={colors.textSecondary} />
      <Text style={styles.metaText} numberOfLines={1} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

/** A supplier: the name, contact person, number, email and address, and `Inactive`. Tap to open. */
export const SupplierCard = memo(function SupplierCard({ supplier, onPress }: { supplier: Supplier; onPress: (supplier: Supplier) => void }) {
  const testID = `supplier-card-${supplier.id}`;
  const spoken = [supplier.name, supplier.contact_person, supplier.contact_number, supplier.is_active ? null : 'inactive']
    .filter(Boolean)
    .join(', ');

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens the supplier"
        onPress={() => onPress(supplier)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.titleRow}>
          <IconBadge icon="business-outline" />
          <Text style={styles.name} numberOfLines={2}>
            {supplier.name}
          </Text>
          {supplier.is_active ? null : <Chip label="Inactive" variant="neutral" testID={`${testID}-inactive`} />}
        </View>
        {supplier.contact_person ? <MetaLine icon="person-outline" text={supplier.contact_person} testID={`${testID}-person`} /> : null}
        {supplier.contact_number ? <MetaLine icon="call-outline" text={supplier.contact_number} testID={`${testID}-number`} /> : null}
        {supplier.email ? <MetaLine icon="mail-outline" text={supplier.email} testID={`${testID}-email`} /> : null}
        {supplier.address ? <MetaLine icon="location-outline" text={supplier.address} testID={`${testID}-address`} /> : null}
        {!supplier.contact_person && !supplier.contact_number && !supplier.email && !supplier.address ? (
          <Text style={styles.metaText}>No contact details</Text>
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
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaText: {
    ...typography.bodySm,
    color: colors.textSecondary,
    flex: 1,
  },
});
