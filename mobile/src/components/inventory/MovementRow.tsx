import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { movementTypeInfo, signedQty } from '@/components/inventory/inventoryLabels';
import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, numeric, opacity, radius, sizes, spacing, status, typography } from '@/constants/theme';
import type { InventoryMovement } from '@/services/types';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';
import { formatCount } from '@/utils/numbers';

/** A movement's order / refund / purchase-order reference, as the row shows it. */
export type MovementRowReference = {
  label: string;
  /** Screen-reader label of the link, e.g. `Open order INV-…`. */
  spoken: string;
  /** `undefined`: shown as plain text (no access to where it leads). */
  onOpen?: () => void;
};

type Tone = { tint: string; icon: string; text: string };

const NEUTRAL_TONE: Tone = { tint: colors.surfaceMuted, icon: colors.textResting, text: colors.textResting };

function statusTone(key: keyof typeof status): Tone {
  return { tint: status[key].tint, icon: status[key].color, text: status[key].text };
}

/**
 * The soft icon tile and delta colour of each movement kind (Sage "Inventory"
 * board): stock in / opening green, sales neutral, voids, refunds and cost
 * changes blue, wastage orange, counts and adjustments amber. The delta uses
 * the AA text shade of its tone; the sign always says in or out.
 */
const TONES: Readonly<Record<string, Tone>> = {
  receipt: statusTone('completed'),
  opening: statusTone('completed'),
  sale: NEUTRAL_TONE,
  void: statusTone('processing'),
  refund: statusTone('processing'),
  revaluation: statusTone('processing'),
  wastage: statusTone('pending'),
  count: statusTone('caution'),
  adjustment: statusTone('caution'),
};

type MovementRowViewProps = {
  /** The movement's ULID (test IDs: `movement-<ulid>-…`). */
  id: string;
  type: string;
  /** Overrides the type's label (e.g. an ingredient's `Used · sale`). */
  label?: string;
  /** `+24`, `-240 g`. */
  qtyText: string;
  /** `→ 33 on hand`. */
  afterText: string;
  /** `Marco Manager · 27 Sep 2026, 10:00 AM`. */
  metaText: string;
  reason: string | null;
  /** Extra caption lines (unit cost, the entered quantity, the value). */
  details?: readonly { key: string; text: string }[];
  reference?: MovementRowReference | null;
};

/**
 * One stock movement in a history (products and ingredients): a soft icon
 * tile coloured by the movement kind, the label with the signed quantity on
 * the right, the running balance, who and when, the reason, extra details,
 * and the reference link.
 */
export const MovementRowView = memo(function MovementRowView({
  id,
  type,
  label,
  qtyText,
  afterText,
  metaText,
  reason,
  details = [],
  reference,
}: MovementRowViewProps) {
  const info = movementTypeInfo(type);
  const tone = TONES[type] ?? NEUTRAL_TONE;
  const testID = `movement-${id}`;

  return (
    <View style={styles.row} testID={testID}>
      <View style={[styles.icon, { backgroundColor: tone.tint }]}>
        <Icon name={info.icon} size={iconSizes.md} color={tone.icon} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={styles.label} numberOfLines={2} testID={`${testID}-type`}>
            {label ?? info.label}
          </Text>
          <Text style={[styles.qty, { color: tone.text }]} testID={`${testID}-qty`}>
            {qtyText}
          </Text>
        </View>
        <Text style={styles.after} testID={`${testID}-after`}>
          {afterText}
        </Text>
        <Text style={styles.muted} numberOfLines={2} testID={`${testID}-meta`}>
          {metaText}
        </Text>
        {reason ? (
          <Text style={styles.reason} numberOfLines={3} testID={`${testID}-reason`}>
            {reason}
          </Text>
        ) : null}
        {details.map((detail) => (
          <Text key={detail.key} style={styles.muted} testID={`${testID}-${detail.key}`}>
            {detail.text}
          </Text>
        ))}
        {reference ? (
          reference.onOpen ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={reference.spoken}
              onPress={reference.onOpen}
              hitSlop={(hitTarget.min - sizes.chipMinHeight) / 2}
              style={({ pressed }) => [styles.reference, pressed && styles.referencePressed]}
              testID={`${testID}-reference`}
            >
              <Icon name="receipt-outline" size={iconSizes.sm} color={colors.primary} />
              <Text style={styles.referenceText} numberOfLines={1}>
                {reference.label}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.muted} numberOfLines={1} testID={`${testID}-reference`}>
              {reference.label}
            </Text>
          )
        ) : null}
      </View>
    </View>
  );
});

type MovementRowProps = {
  movement: InventoryMovement;
  /** The branch's IANA timezone (times show in branch time). */
  timeZone: string;
  /** Opens the order of a sale, void or refund; `undefined` shows the reference as plain text (no Orders access). */
  onOpenReference?: (orderUlid: string) => void;
};

/**
 * One product stock movement: the signed quantity, `→ 33 on hand`
 * (`qty_after`), who and when (branch time), the reason, the unit cost of a
 * stock in, and for a sale, void or refund its order reference, which opens the order.
 */
export const MovementRow = memo(function MovementRow({ movement, timeZone, onOpenReference }: MovementRowProps) {
  const when = formatBranchDateTime(movement.occurred_at, timeZone) ?? movement.occurred_at;
  const who = movement.created_by?.name;
  const reference = movement.reference;

  return (
    <MovementRowView
      id={movement.ulid}
      type={movement.type}
      qtyText={signedQty(movement.qty_delta)}
      afterText={`→ ${formatCount(movement.qty_after)} on hand`}
      metaText={who ? `${who} · ${when}` : when}
      reason={movement.reason}
      details={
        movement.type === 'receipt' && movement.unit_cost_cents !== null
          ? [{ key: 'cost', text: `Unit cost ${formatPeso(movement.unit_cost_cents)}` }]
          : []
      }
      reference={
        reference
          ? {
              label: reference.label,
              spoken: `Open ${reference.kind === 'refund' ? 'the refunded order' : 'order'} ${reference.label}`,
              onOpen: onOpenReference ? () => onOpenReference(reference.ulid) : undefined,
            }
          : null
      }
    />
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderLeftWidth: sizes.borderWidth,
    borderRightWidth: sizes.borderWidth,
    borderBottomWidth: sizes.borderWidth,
    borderLeftColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.divider,
  },
  icon: {
    width: sizes.badge.md,
    height: sizes.badge.md,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    ...typography.control,
    color: colors.text,
    flexShrink: 1,
  },
  qty: {
    ...typography.controlStrong,
    ...numeric,
    flexShrink: 0,
  },
  after: {
    ...typography.label,
    ...numeric,
    color: colors.textResting,
  },
  muted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  reason: {
    ...typography.bodySm,
    color: colors.text,
  },
  reference: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: sizes.chipMinHeight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primarySoft,
  },
  referencePressed: {
    opacity: opacity.pressed,
  },
  referenceText: {
    ...typography.captionStrong,
    color: colors.primaryDark,
  },
});
