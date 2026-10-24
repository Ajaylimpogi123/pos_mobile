import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, type ChipVariant } from '@/components/ui/Chip';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import type { IconName } from '@/components/ui/Icon';
import { Skeleton, SkeletonPulse } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { colors, layout, radius, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { StockStatus } from '@/services/types';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type StockAction = {
  key: string;
  title: string;
  icon: IconName;
  /** `primary`: the one green pill (Stock in); the rest are outline buttons (MASTER §6). */
  variant: 'primary' | 'secondary';
  onPress: () => void;
  testID: string;
};

/** The action row: 44–48 dp buttons that wrap on narrow screens. */
export function StockActions({ actions, disabled, testID }: { actions: readonly StockAction[]; disabled?: boolean; testID: string }) {
  return (
    <View style={styles.actions} testID={testID}>
      {actions.map((action) => (
        <Button
          key={action.key}
          title={action.title}
          leftIcon={action.icon}
          variant={action.variant}
          onPress={action.onPress}
          disabled={disabled}
          style={styles.action}
          testID={action.testID}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The page header and the summary stat cards
// ---------------------------------------------------------------------------

export type StockStat = {
  key: string;
  label: string;
  value: string;
  icon: IconName;
  footnote?: string | null;
  /** On the value. */
  testID: string;
  footnoteTestID?: string;
  /** A quiet action under the figure (the reorder level's **Edit**). */
  action?: { title: string; onPress: () => void; testID: string } | null;
};

type StockSummaryProps = {
  name: string;
  /** Muted line under the name (category · SKU, or the base unit). */
  caption?: string | null;
  status: { label: string; variant: ChipVariant };
  /** The status drives the stock accent: Low / Out use the orange §1.4 accent on the On hand card. */
  stockStatus: StockStatus | null;
  /** On hand first (it takes the accent), then the rest (neutral). */
  stats: readonly StockStat[];
  lastMovement: string | null;
  /** The action row (permission-gated by the caller). */
  actions?: ReactElement | null;
  /** `inventory-summary` / `ingredient-summary`: the block, `-status`, `-last`. */
  testID: string;
};

/**
 * The top of a stock detail (like the web's stock page): the name with its
 * status badge, a muted caption and the last movement, the actions, then a
 * row of stat cards (on hand, cost, value, reorder level). Only On hand takes
 * the orange stock accent, and only when the stock is Low or Out; the other
 * figures stay neutral. Four cards per row on tablets, two on phones in portrait.
 */
export function StockSummary({ name, caption, status, stockStatus, stats, lastMovement, actions, testID }: StockSummaryProps) {
  const { isPhone, isPortrait, gutter } = useResponsive();
  const statBasis = isPhone && isPortrait ? '40%' : '20%';
  const alert = stockStatus === 'low' || stockStatus === 'out';
  return (
    <View style={{ gap: gutter }} testID={testID}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
              {name}
            </Text>
            <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} />
          </View>
          {caption ? (
            <Text style={styles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
          {lastMovement ? (
            <Text style={styles.caption} numberOfLines={1} testID={`${testID}-last`}>
              {`Last movement ${lastMovement}`}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={styles.headActions}>{actions}</View> : null}
      </View>
      <View style={[styles.stats, { gap: gutter }]}>
        {stats.map((stat, index) => (
          <View key={stat.key} style={[styles.stat, { flexBasis: statBasis }]}>
            <StatCard
              label={stat.label}
              value={stat.value}
              icon={stat.icon}
              accent={index === 0 && alert ? 'stock' : null}
              footnote={stat.footnote}
              valueTestID={stat.testID}
              footnoteTestID={stat.footnoteTestID}
              action={
                stat.action ? (
                  <Button title={stat.action.title} leftIcon="create-outline" variant="ghost" onPress={stat.action.onPress} testID={stat.action.testID} />
                ) : null
              }
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type HistoryTypesProps<T extends string> = {
  types: readonly { value: T; label: string; icon: IconName }[];
  value: T | null;
  onChange: (value: T | null) => void;
  /** `<prefix>-all`, `<prefix>-<type>`. */
  testIDPrefix: string;
  testID?: string;
};

/** The `History` title and the movement-type filter pills. */
export function HistoryHeader<T extends string>({ types, value, onChange, testIDPrefix, testID }: HistoryTypesProps<T>) {
  return (
    <View style={styles.historyHeader}>
      <View style={styles.historyTitle}>
        <SectionLabel>History</SectionLabel>
        {value === null ? <Text style={styles.caption}>Newest first</Text> : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chips}
        testID={testID}
      >
        <ChoiceChip label="All types" selected={value === null} onPress={() => onChange(null)} testID={`${testIDPrefix}-all`} />
        {types.map((type) => (
          <ChoiceChip
            key={type.value}
            label={type.label}
            icon={type.icon}
            selected={value === type.value}
            onPress={() => onChange(type.value)}
            testID={`${testIDPrefix}-${type.value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

type HistoryQuery = {
  isPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  items: readonly unknown[];
  grid: { error: unknown; onRetry: () => void; nextPageError: unknown; fetchNextPage: () => void };
};

/**
 * The history's first-load, error and empty states (`null` once there are
 * rows): skeleton rows, the error with **Retry**, or an empty message.
 * Test IDs: `<prefix>-loading`, `-error`, `-retry`, `-empty`.
 */
export function historyState(history: HistoryQuery, filtered: boolean, emptyText: string, testIDPrefix: string): ReactElement | null {
  if (history.isPending) {
    return (
      <View style={styles.skeletons} accessible accessibilityRole="progressbar" accessibilityLabel="Loading history…" testID={`${testIDPrefix}-loading`}>
        <SkeletonPulse>
          {[0, 1, 2].map((index) => (
            <View key={index} style={[styles.skeletonRow, index === 2 && styles.skeletonLast]}>
              <Skeleton width={sizes.badge.md} height={sizes.badge.md} radius={radius.inner} />
              <View style={styles.flexGap}>
                <Skeleton width="55%" height={sizes.skeleton.lineLarge} />
                <Skeleton width="35%" />
              </View>
            </View>
          ))}
        </SkeletonPulse>
      </View>
    );
  }
  if (history.grid.error) {
    return (
      <Card style={styles.state} testID={`${testIDPrefix}-error`}>
        <Text style={styles.stateText}>{getErrorMessage(history.grid.error)}</Text>
        <Button title="Retry" leftIcon="refresh" variant="secondary" onPress={history.grid.onRetry} testID={`${testIDPrefix}-retry`} />
      </Card>
    );
  }
  if (history.items.length === 0) {
    return (
      <Card style={styles.state} testID={`${testIDPrefix}-empty`}>
        <Text style={styles.stateTitle}>{filtered ? 'No movements of this type' : 'No movements yet'}</Text>
        <Text style={styles.stateText}>{emptyText}</Text>
      </Card>
    );
  }
  return null;
}

/** The DataTable cursor footer ("Showing n" + **Load more**) of a movement history. */
export function historyPagination(history: HistoryQuery) {
  return {
    shown: history.items.length,
    hasNextPage: history.hasNextPage,
    isFetchingNextPage: history.isFetchingNextPage,
    nextPageError: history.grid.nextPageError,
    fetchNextPage: history.grid.fetchNextPage,
  };
}

const styles = StyleSheet.create({
  flexGap: {
    flex: 1,
    gap: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: layout.sectionTitleMinWidth * 2,
    gap: spacing.xxs,
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.title,
    color: colors.text,
    flexShrink: 1,
  },
  headActions: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: layout.sectionTitleMinWidth * 3,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    flexGrow: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
    flexBasis: layout.sectionTitleMinWidth,
  },
  historyHeader: {
    gap: spacing.sm,
  },
  historyTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  skeletons: {
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  skeletonLast: {
    borderBottomWidth: 0,
  },
  state: {
    alignItems: 'center',
    gap: spacing.md,
  },
  stateTitle: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
