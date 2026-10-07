import { memo, type ReactElement } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/shared/FormSection';
import { DetailRow } from '@/components/shared/InfoCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, type ChipVariant } from '@/components/ui/Chip';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import type { IconName } from '@/components/ui/Icon';
import { Skeleton, SkeletonPulse } from '@/components/ui/Skeleton';
import { colors, layout, radius, sizes, spacing, typography } from '@/constants/theme';
import { getErrorMessage } from '@/services/api';

// ---------------------------------------------------------------------------
// The stock header card
// ---------------------------------------------------------------------------

export type StockMetric = {
  label: string;
  value: string;
  /** A muted line under the value (e.g. `30 kg on hand`). */
  sub?: string | null;
  /** The value is at or below zero (drawn in the danger text colour). */
  danger?: boolean;
  /** On the value; the sub line is `<testID>`-less unless `subTestID` is set. */
  testID: string;
  subTestID?: string;
};

type StockHeaderCardProps = {
  name: string;
  /** Muted line under the name (category · SKU, or the base unit). */
  caption?: string | null;
  status: { label: string; variant: ChipVariant };
  /** Exactly two tiles: on hand, then the (average) cost. */
  metrics: readonly [StockMetric, StockMetric];
  reorderText: string;
  /** Shows **Edit** beside the reorder level. */
  onEditReorder?: () => void;
  stockValue: string;
  lastMovement: string | null;
  /** `inventory-summary` / `ingredient-summary`: the card, `-status`, `-reorder`, `-value`, `-last`. */
  testID: string;
  /** Test ID of the reorder **Edit** button. */
  editTestID: string;
};

/**
 * The top of a stock detail (Sage "Inventory" board): the name and the status
 * chip, two metric tiles (on hand, cost), the reorder level with **Edit**, the
 * stock value and the last movement.
 */
export const StockHeaderCard = memo(function StockHeaderCard({
  name,
  caption,
  status,
  metrics,
  reorderText,
  onEditReorder,
  stockValue,
  lastMovement,
  testID,
  editTestID,
}: StockHeaderCardProps) {
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
            {name}
          </Text>
          {caption ? (
            <Text style={styles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
        <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} />
      </View>

      <View style={styles.metrics}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metric}>
            <Text style={styles.metricLabel} numberOfLines={1}>
              {metric.label}
            </Text>
            <Text
              style={[styles.metricValue, metric.danger && styles.danger]}
              numberOfLines={1}
              adjustsFontSizeToFit
              testID={metric.testID}
            >
              {metric.value}
            </Text>
            {metric.sub ? (
              <Text style={styles.caption} numberOfLines={1} testID={metric.subTestID}>
                {metric.sub}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.reorderRow}>
        <View style={styles.flex}>
          <DetailRow label="Reorder level" value={reorderText} testID={`${testID}-reorder`} />
        </View>
        {onEditReorder ? <Button title="Edit" leftIcon="create-outline" variant="secondary" onPress={onEditReorder} testID={editTestID} /> : null}
      </View>
      <View style={styles.details}>
        <View style={styles.detail}>
          <DetailRow label="Stock value" value={stockValue} testID={`${testID}-value`} />
        </View>
        {lastMovement ? (
          <View style={styles.detail}>
            <DetailRow label="Last movement" value={lastMovement} testID={`${testID}-last`} />
          </View>
        ) : null}
      </View>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type StockAction = {
  key: string;
  title: string;
  icon: IconName;
  variant: 'secondary' | 'tonal';
  onPress: () => void;
  testID: string;
};

/** The action row (48 dp buttons that wrap two per line on narrow screens). */
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

/** The `HISTORY` label and the movement-type filter pills. */
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

/** The load-more footer: a spinner, or the page error with **Load more**. */
export function historyFooter(history: HistoryQuery, testIDPrefix: string): ReactElement | null {
  if (history.isFetchingNextPage) {
    return <ActivityIndicator style={styles.footer} color={colors.primaryBright} testID={`${testIDPrefix}-loading-more`} />;
  }
  if (history.grid.nextPageError) {
    return (
      <View style={[styles.footer, styles.footerError]} testID={`${testIDPrefix}-more-error`}>
        <Banner message={getErrorMessage(history.grid.nextPageError)} />
        <Button title="Load more" leftIcon="refresh" variant="secondary" onPress={history.grid.fetchNextPage} />
      </View>
    );
  }
  return null;
}

/** Rows of the history form one card: this closes its bottom edge. */
export function HistoryCardEnd() {
  return <View style={styles.cardEnd} />;
}

/** Opens the rows' card: its top edge, above the first row. */
export function HistoryCardStart() {
  return <View style={styles.cardStart} />;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexGap: {
    flex: 1,
    gap: spacing.sm,
  },
  card: {
    gap: spacing.lg,
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
  name: {
    ...typography.heading,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  metricLabel: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  metricValue: {
    ...typography.metricValue,
    color: colors.text,
  },
  danger: {
    color: colors.dangerText,
  },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  detail: {
    flexGrow: 1,
    flexBasis: layout.sectionTitleMinWidth,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  footer: {
    paddingVertical: spacing.lg,
  },
  footerError: {
    gap: spacing.md,
  },
  cardStart: {
    height: spacing.xs,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardEnd: {
    height: spacing.xs,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderTopWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
