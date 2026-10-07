import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, opacity, radius, sizes, spacing, typography } from '@/constants/theme';
import type { RoutableCategory } from '@/db/menuQueries';
import type { Printer } from '@/services/types';

type PrinterCategoryFieldProps = {
  /** The categories on this tablet (active and inactive). */
  categories: readonly RoutableCategory[];
  loading: boolean;
  loadError: string | null;
  selectedIds: readonly number[];
  onChange: (ids: number[]) => void;
  /** The branch's other printers: a category routed to one of them is labelled "at <name>". */
  otherPrinters: readonly Printer[];
  error?: string | null;
  disabled?: boolean;
};

type Row = { id: number; name: string; isActive: boolean; known: boolean };

/**
 * Multi-select of the categories this kitchen or bar printer takes. A
 * category already routed to another printer says so ("at Bar"); choosing it
 * here moves it (the server moves routes, never duplicates them).
 */
export function PrinterCategoryField({
  categories,
  loading,
  loadError,
  selectedIds,
  onChange,
  otherPrinters,
  error,
  disabled = false,
}: PrinterCategoryFieldProps) {
  const selected = new Set(selectedIds);
  const rows: Row[] = categories.map((category) => ({ id: category.id, name: category.name, isActive: category.is_active, known: true }));
  // A route to a category this tablet hasn't synced yet stays visible (and removable).
  for (const id of selectedIds) {
    if (!categories.some((category) => category.id === id)) rows.push({ id, name: `Category #${id}`, isActive: true, known: false });
  }

  function toggle(id: number) {
    onChange(selected.has(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  }

  function routedElsewhere(id: number): Printer | undefined {
    return otherPrinters.find((printer) => printer.category_ids.includes(id));
  }

  return (
    <View style={styles.container} testID="printer-categories">
      <Text style={styles.help}>
        Items from these categories print here. Items from categories with no printer go to the default kitchen printer.
      </Text>
      {loadError ? <Banner variant="warning" message={loadError} /> : null}
      {loading ? <Text style={styles.help}>Loading categories…</Text> : null}
      {!loading && rows.length === 0 ? (
        <Text style={styles.help}>No categories on this tablet yet. Sync the menu on the Sell screen first.</Text>
      ) : null}
      {rows.map((row) => {
        const isSelected = selected.has(row.id);
        const elsewhere = isSelected ? undefined : routedElsewhere(row.id);
        return (
          <Pressable
            key={row.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`${row.name}${elsewhere ? `, now at ${elsewhere.name}` : ''}`}
            accessibilityState={{ checked: isSelected, disabled }}
            disabled={disabled}
            onPress={() => toggle(row.id)}
            style={({ pressed }) => [styles.row, isSelected && styles.rowSelected, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
            testID={`printer-category-${row.id}`}
          >
            <View style={[styles.box, isSelected && styles.boxChecked]}>
              {isSelected ? <Icon name="checkmark" size={iconSizes.sm} color={colors.onPrimary} /> : null}
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {row.name}
            </Text>
            {row.isActive ? null : <Chip label="Inactive" />}
            {row.known ? null : <Chip label="Not on this tablet" variant="warning" />}
            {elsewhere ? <Chip label={`at ${elsewhere.name}`} variant="info" testID={`printer-category-${row.id}-elsewhere`} /> : null}
          </Pressable>
        );
      })}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="printer-categories-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    minHeight: hitTarget.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  rowSelected: {
    backgroundColor: colors.primarySoft,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
  },
  rowDisabled: {
    opacity: opacity.disabled,
  },
  box: {
    width: sizes.checkbox,
    height: sizes.checkbox,
    borderRadius: radius.sm,
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
