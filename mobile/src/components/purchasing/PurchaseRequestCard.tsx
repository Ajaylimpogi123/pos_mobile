import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { chipFor, PO_STATUS, PR_STATUS } from '@/components/purchasing/purchasingLabels';
import { Chip } from '@/components/ui/Chip';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';
import type { PurchaseDecision, PurchaseRequest, PurchaseRequestItem } from '@/services/types';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatBusinessDate } from '@/utils/dates';
import { formatPeso } from '@/utils/money';
import { lineTotalCents } from '@/utils/quantity';

/** `Flour, Eggs +2`. */
export function itemNames(names: readonly string[], shown = 2): string {
  if (names.length === 0) return 'No items';
  const head = names.slice(0, shown).join(', ');
  return names.length > shown ? `${head} +${names.length - shown}` : head;
}

/** `2 approved · 1 declined · 1 pending` (only the non-zero ones). */
export function decisionSummary(pr: Pick<PurchaseRequest, 'items'>): string {
  const count = { approved: 0, declined: 0, pending: 0 };
  for (const item of pr.items) count[item.decision] += 1;
  return (['approved', 'declined', 'pending'] as const)
    .filter((key) => count[key] > 0)
    .map((key) => `${count[key]} ${key}`)
    .join(' · ');
}

/** An item's estimate (`estimated_unit_price_cents × qty`, integer centavos), or `null` without a price. */
export function itemEstimateCents(item: Pick<PurchaseRequestItem, 'estimated_unit_price_cents' | 'qty'>): number | null {
  return item.estimated_unit_price_cents === null ? null : lineTotalCents(item.estimated_unit_price_cents, item.qty);
}

/**
 * The estimated total of the items (optionally only those with one decision),
 * or `null` when any of them has no estimated price (a partial sum would mislead).
 */
export function estimateTotalCents(items: readonly PurchaseRequestItem[], decision?: PurchaseDecision): number | null {
  let total = 0;
  for (const item of items) {
    if (decision && item.decision !== decision) continue;
    const cents = itemEstimateCents(item);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}

function itemsCount(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

type PurchaseRequestCardProps = {
  pr: PurchaseRequest;
  timeZone: string;
  /** Receives the PR, so the list passes one stable handler to the memoized cards. */
  onPress: (pr: PurchaseRequest) => void;
};

/**
 * One purchase request (Sage "Purchasing" board): the PR number and status
 * chip, a meta line (who, how many items, the estimate when every item has
 * one), the items and when they were asked for, the decisions so far and the
 * date needed, and its PO when one was created. The whole card opens the PR.
 */
export const PurchaseRequestCard = memo(function PurchaseRequestCard({ pr, timeZone, onPress }: PurchaseRequestCardProps) {
  const testID = `pr-card-${pr.ulid}`;
  const status = chipFor(PR_STATUS, pr.status);
  const created = formatBranchDateTime(pr.created_at, timeZone) ?? pr.created_at;
  const estimate = pr.items.length > 0 ? estimateTotalCents(pr.items) : null;
  const meta = [pr.requested_by.name, itemsCount(pr.items.length)];
  if (estimate !== null) meta.push(`Est. ${formatPeso(estimate)}`);
  const po = pr.purchase_order ? chipFor(PO_STATUS, pr.purchase_order.status) : null;

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${pr.pr_no}, ${status.label}, ${itemsCount(pr.items.length)}, by ${pr.requested_by.name}`}
        accessibilityHint="Opens the purchase request"
        onPress={() => onPress(pr)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.titleRow}>
          <Text style={styles.number} numberOfLines={1}>
            {pr.pr_no}
          </Text>
          <Chip label={status.label} variant={status.variant} testID={`${testID}-status`} />
        </View>
        <Text style={styles.meta} numberOfLines={1} testID={`${testID}-meta`}>
          {meta.join(' · ')}
        </Text>
        <Text style={styles.items} numberOfLines={2} testID={`${testID}-items`}>
          {itemNames(pr.items.map((item) => item.item.name))}
          <Text style={styles.meta}>{` · ${itemNames([...new Set(pr.items.map((item) => item.supplier.name))])}`}</Text>
        </Text>
        <View style={styles.footer}>
          <Text style={styles.caption} numberOfLines={1} testID={`${testID}-decisions`}>
            {decisionSummary(pr)}
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            {pr.date_needed ? `Needed ${formatBusinessDate(pr.date_needed)}` : created}
          </Text>
        </View>
        {pr.purchase_order && po ? (
          <View style={styles.po}>
            <Chip label={pr.purchase_order.po_no} icon="clipboard-outline" variant="primary" testID={`${testID}-po`} />
            <Chip label={po.label} variant={po.variant} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  body: {
    flexGrow: 1,
    gap: spacing.sm,
    paddingVertical: spacing.md + spacing.xxs,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  number: {
    ...typography.bodyStrong,
    fontFamily: typography.heading.fontFamily,
    color: colors.text,
    flexShrink: 1,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  items: {
    ...typography.control,
    color: colors.text,
  },
  caption: {
    ...typography.captionMedium,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  po: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
