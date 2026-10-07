import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SEARCH_MAX_LENGTH } from '@/components/shared/ListFilters';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { colors, hitTarget, iconSizes, radius, sizes, spacing, typography } from '@/constants/theme';
import { useCustomerList } from '@/hooks/customers/useCustomers';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useCanReachServer } from '@/hooks/useIsOnline';
import { getErrorMessage } from '@/services/api';
import type { CartCustomer } from '@/stores/cart';

type CustomerPickerDialogProps = {
  /** The customer on the sale now (offers "No customer"). */
  current: CartCustomer | null;
  onChoose: (customer: CartCustomer | null) => void;
  onClose: () => void;
};

/**
 * Attach a customer to the sale: `GET /api/v1/customers` with a search (names,
 * phone, email; 300 ms debounce), 25 at a time with "Load more". Mounted only
 * while open, so the list is fetched on demand.
 *
 * Offline Sales (Phase 5): customer search needs a connection, so offline the
 * picker says so and fetches nothing. A customer already attached stays
 * ("No customer" still removes it).
 */
export const CUSTOMER_OFFLINE_MESSAGE =
  'Customer search needs a connection. A customer already on this sale stays on it.';

export function CustomerPickerDialog({ current, onChoose, onClose }: CustomerPickerDialogProps) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const online = useCanReachServer();
  const list = useCustomerList(debounced, online);
  const { grid } = list;

  let body;
  if (!online) {
    body = <Banner variant="warning" message={CUSTOMER_OFFLINE_MESSAGE} testID="customer-picker-offline" />;
  } else if (grid.loading) {
    body = <ActivityIndicator color={colors.primaryBright} style={styles.spinner} testID="customer-picker-loading" />;
  } else if (grid.error) {
    body = (
      <View style={styles.errorBox}>
        <Banner message={getErrorMessage(grid.error)} testID="customer-picker-error" />
        <Button title="Retry" leftIcon="refresh" variant="secondary" onPress={grid.onRetry} testID="customer-picker-retry" />
      </View>
    );
  } else if (list.items.length === 0) {
    body = (
      <Text style={styles.empty} testID="customer-picker-empty">
        {debounced === '' ? 'No customers yet. Add them in Customers.' : 'No matching customers.'}
      </Text>
    );
  } else {
    body = (
      <View>
        {list.items.map((customer, index) => (
          <Pressable
            key={customer.id}
            accessibilityRole="button"
            accessibilityLabel={[customer.full_name, customer.contact].filter(Boolean).join(', ')}
            accessibilityState={{ selected: current?.id === customer.id }}
            onPress={() => onChoose({ id: customer.id, full_name: customer.full_name })}
            testID={`customer-option-${customer.id}`}
            style={({ pressed }) => [styles.option, index > 0 && styles.divider, pressed && styles.pressed]}
          >
            <Icon name="person-circle-outline" size={iconSizes.lg} color={colors.textSecondary} />
            <View style={styles.optionText}>
              <Text style={styles.name} numberOfLines={1}>
                {customer.full_name}
              </Text>
              {customer.contact || customer.email ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {[customer.contact, customer.email].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            {current?.id === customer.id ? <Icon name="checkmark-circle" size={iconSizes.md} color={colors.primary} /> : null}
          </Pressable>
        ))}
        {grid.hasNextPage ? (
          <Button
            title="Load more"
            variant="ghost"
            onPress={grid.fetchNextPage}
            loading={grid.isFetchingNextPage}
            testID="customer-picker-more"
          />
        ) : null}
      </View>
    );
  }

  return (
    <DialogFrame visible onRequestClose={onClose} testID="customer-picker">
      <Text style={styles.title} accessibilityRole="header">
        Customer
      </Text>
      <Input
        label="Search"
        variant="search"
        value={search}
        onChangeText={setSearch}
        placeholder="Name, phone or email"
        leftIcon="search"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={SEARCH_MAX_LENGTH}
        editable={online}
        testID="customer-picker-search"
      />
      {body}
      <View style={styles.actions}>
        {current ? (
          <Button
            title="No customer"
            variant="danger"
            onPress={() => onChoose(null)}
            style={styles.action}
            testID="customer-picker-none"
          />
        ) : null}
        <Button title="Close" variant="secondary" onPress={onClose} style={styles.action} testID="customer-picker-close" />
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  errorBox: {
    gap: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  option: {
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
  optionText: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
});
