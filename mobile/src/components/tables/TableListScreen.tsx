import { memo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListHeader } from '@/components/shared/ListHeader';
import { TableFormDialog } from '@/components/tables/TableFormDialog';
import { seatsLabel, tableLabel } from '@/components/tables/tableLabels';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/LoadingState';
import { Screen } from '@/components/ui/Screen';
import { colors, hitTarget, iconSizes, layout, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { useAdminTables } from '@/hooks/tables/useAdminTables';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { DiningTable } from '@/services/types';

type RowProps = { table: DiningTable; onPress: (table: DiningTable) => void };

const TableRow = memo(function TableRow({ table, onPress }: RowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tableLabel(table.name)}, ${seatsLabel(table.seats)}, ${table.is_active ? 'active' : 'inactive'}`}
      accessibilityHint="Opens the table to edit it"
      onPress={() => onPress(table)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`table-row-${table.id}`}
    >
      <View style={styles.rowIcon}>
        <Icon name="restaurant-outline" size={iconSizes.md} color={colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {tableLabel(table.name)}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {seatsLabel(table.seats)} · Sort {table.sort_order}
        </Text>
      </View>
      <Chip label={table.is_active ? 'Active' : 'Inactive'} variant={table.is_active ? 'success' : 'neutral'} size="sm" />
      <Icon name="chevron-forward" size={iconSizes.md} color={colors.textSecondary} />
    </Pressable>
  );
});

/**
 * Admin → **Tables** (`settings.manage`; Dine-in Tables & Tabs §B and §I):
 * the branch's tables grouped by area (inactive ones included), with **New
 * table**, and a tap to edit, deactivate or delete. Every list state:
 * loading, empty, error with Retry and pull-to-refresh (all pages are read).
 * Works while dine-in is off, so tables can be set up first.
 */
export function TableListScreen() {
  const screen = useAdminTables();
  const { screenPaddingX, screenPaddingY } = useResponsive();
  const { list, groups } = screen;
  const refresh = <RefreshControl refreshing={list.isRefetching && !list.isPending} onRefresh={() => void list.refetch()} />;

  let body;
  if (list.grid.loading) body = <LoadingState variant="list" message="Loading tables…" testID="tables-loading" />;
  else if (list.grid.error) {
    body = (
      <ErrorState
        title="Couldn't load the tables"
        message={getErrorMessage(list.grid.error)}
        onRetry={list.grid.onRetry}
        refreshControl={refresh}
        testID="tables-error"
      />
    );
  } else if (list.items.length === 0) {
    body = (
      <EmptyState
        title="No tables yet"
        message="Add the restaurant's tables, grouped by area, to take dine-in orders."
        icon="restaurant-outline"
        actionLabel="New table"
        onAction={screen.openNew}
        refreshControl={refresh}
        testID="tables-empty"
      />
    );
  } else {
    body = (
      <SectionList
        sections={groups.map((group) => ({ key: group.key, title: group.title, data: group.items }))}
        keyExtractor={(table) => String(table.id)}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {section.title} · {section.data.length}
          </Text>
        )}
        renderItem={({ item }) => <TableRow table={item} onPress={screen.openTable} />}
        stickySectionHeadersEnabled={false}
        refreshControl={refresh}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY, maxWidth: layout.formWideMaxWidth },
        ]}
        testID="tables-list"
      />
    );
  }

  return (
    <Screen edges={[]} testID="table-list-screen">
      <ListHeader band title="Tables" subtitle="Dine-in tables by area" newLabel="New table" newTitle="New table" onNew={screen.openNew} testIDPrefix="tables" />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.body}>
        {body}
      </SafeAreaView>
      <TableFormDialog screen={screen} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  /** The list sits in a white card over the band (its section titles never land on the band). */
  content: {
    width: '100%',
    alignSelf: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.textSecondary,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.listRow,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: pressedScale }],
    opacity: opacity.pressed,
  },
  rowIcon: {
    width: hitTarget.min,
    height: hitTarget.min,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  rowMeta: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
