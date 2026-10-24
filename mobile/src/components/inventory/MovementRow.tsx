import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { movementTypeInfo, signedQty } from '@/components/inventory/inventoryLabels';
import { Card } from '@/components/ui/Card';
import { CellText, type DataTableColumn } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, numeric, opacity, radius, sizes, spacing, status, typography } from '@/constants/theme';
import type { InventoryMovement } from '@/services/types';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

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
 * The soft icon tile and delta colour of each movement kind: stock in /
 * opening green, sales neutral, voids, refunds and cost changes blue, wastage
 * orange, counts and adjustments amber. The delta uses the AA text shade of
 * its tone; the sign always says in or out.
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

/** What one history row shows (products and ingredients). */
export type MovementView = {
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

/** The test ID of a movement row (`movement-<ulid>`). */
export function movementTestID(id: string): string {
  return `movement-${id}`;
}

function TypeTile({ type }: { type: string }) {
  const info = movementTypeInfo(type);
  const tone = TONES[type] ?? NEUTRAL_TONE;
  return (
    <View style={[styles.icon, { backgroundColor: tone.tint }]}>
      <Icon name={info.icon} size={iconSizes.md} color={tone.icon} />
    </View>
  );
}

/** The reference: a link (order / purchase order) or plain text without access. */
function ReferenceLink({ reference, testID }: { reference: MovementRowReference; testID: string }) {
  if (!reference.onOpen) {
    return (
      <Text style={styles.muted} numberOfLines={1} testID={`${testID}-reference`}>
        {reference.label}
      </Text>
    );
  }
  return (
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
  );
}

/**
 * One stock movement as a card (portrait and phones; MASTER §6): a soft icon
 * tile coloured by the movement kind, the label with the signed quantity on
 * the right, the running balance, who and when, the reason, extra details,
 * and the reference link.
 */
export const MovementCard = memo(function MovementCard({ id, type, label, qtyText, afterText, metaText, reason, details = [], reference }: MovementView) {
  const info = movementTypeInfo(type);
  const tone = TONES[type] ?? NEUTRAL_TONE;
  const testID = movementTestID(id);

  return (
    <Card style={styles.card} testID={testID}>
      <TypeTile type={type} />
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
        {reference ? <ReferenceLink reference={reference} testID={testID} /> : null}
      </View>
    </Card>
  );
});

/**
 * The history table's columns (tablet landscape; MASTER §3 data table):
 * Movement (tile, label, reference), Qty and Balance (right, tabular), By /
 * when, and Notes (reason and details). Cells keep the card test IDs
 * (`movement-<ulid>-type`, `-qty`, `-after`, `-meta`, `-reason`, `-<detail>`, `-reference`).
 */
export function movementColumns<T>(toView: (row: T) => MovementView): DataTableColumn<T>[] {
  return [
    {
      key: 'type',
      header: 'Movement',
      flex: 1.4,
      render: (row) => {
        const view = toView(row);
        const testID = movementTestID(view.id);
        return (
          <View style={styles.typeCell}>
            <TypeTile type={view.type} />
            <View style={styles.text}>
              <CellText variant="strong" numberOfLines={2} testID={`${testID}-type`}>
                {view.label ?? movementTypeInfo(view.type).label}
              </CellText>
              {view.reference ? <ReferenceLink reference={view.reference} testID={testID} /> : null}
            </View>
          </View>
        );
      },
    },
    {
      key: 'qty',
      header: 'Qty',
      flex: 0.8,
      align: 'right',
      render: (row) => {
        const view = toView(row);
        const tone = TONES[view.type] ?? NEUTRAL_TONE;
        return (
          <CellText variant="strong" align="right" style={{ color: tone.text }} testID={`${movementTestID(view.id)}-qty`}>
            {view.qtyText}
          </CellText>
        );
      },
    },
    {
      key: 'after',
      header: 'Balance',
      headerAccessibilityLabel: 'On hand after',
      flex: 1,
      align: 'right',
      render: (row) => {
        const view = toView(row);
        return (
          <CellText align="right" numberOfLines={2} testID={`${movementTestID(view.id)}-after`}>
            {view.afterText}
          </CellText>
        );
      },
    },
    {
      key: 'meta',
      header: 'By / when',
      flex: 1.3,
      render: (row) => {
        const view = toView(row);
        return (
          <CellText variant="muted" numberOfLines={2} testID={`${movementTestID(view.id)}-meta`}>
            {view.metaText}
          </CellText>
        );
      },
    },
    {
      key: 'notes',
      header: 'Notes',
      flex: 1.4,
      render: (row) => {
        const view = toView(row);
        const testID = movementTestID(view.id);
        if (!view.reason && (view.details ?? []).length === 0) return <CellText variant="muted">—</CellText>;
        return (
          <View style={styles.notes}>
            {view.reason ? (
              <CellText numberOfLines={3} testID={`${testID}-reason`}>
                {view.reason}
              </CellText>
            ) : null}
            {(view.details ?? []).map((detail) => (
              <CellText key={detail.key} variant="muted" numberOfLines={2} testID={`${testID}-${detail.key}`}>
                {detail.text}
              </CellText>
            ))}
          </View>
        );
      },
    },
  ];
}

/**
 * One product stock movement: the signed quantity, `→ 33 on hand`
 * (`qty_after`), who and when (branch time), the reason, the unit cost of a
 * stock in, and for a sale, void or refund its order reference, which opens
 * the order (`undefined` `onOpenReference`: plain text, no Orders access).
 */
export function productMovementView(
  movement: InventoryMovement,
  timeZone: string,
  onOpenReference?: (orderUlid: string) => void,
): MovementView {
  const when = formatBranchDateTime(movement.occurred_at, timeZone) ?? movement.occurred_at;
  const who = movement.created_by?.name;
  const reference = movement.reference;
  return {
    id: movement.ulid,
    type: movement.type,
    qtyText: signedQty(movement.qty_delta),
    afterText: `→ ${formatCount(movement.qty_after)} on hand`,
    metaText: who ? `${who} · ${when}` : when,
    reason: movement.reason,
    details:
      movement.type === 'receipt' && movement.unit_cost_cents !== null
        ? [{ key: 'cost', text: `Unit cost ${formatPeso(movement.unit_cost_cents)}` }]
        : [],
    reference: reference
      ? {
          label: reference.label,
          spoken: `Open ${reference.kind === 'refund' ? 'the refunded order' : 'order'} ${reference.label}`,
          onOpen: onOpenReference ? () => onOpenReference(reference.ulid) : undefined,
        }
      : null,
  };
}

type MovementRowProps = {
  movement: InventoryMovement;
  /** The branch's IANA timezone (times show in branch time). */
  timeZone: string;
  /** Opens the order of a sale, void or refund; `undefined` shows the reference as plain text (no Orders access). */
  onOpenReference?: (orderUlid: string) => void;
};

/** One product stock movement as a card (see `productMovementView`). */
export const MovementRow = memo(function MovementRow({ movement, timeZone, onOpenReference }: MovementRowProps) {
  return <MovementCard {...productMovementView(movement, timeZone, onOpenReference)} />;
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  icon: {
    width: sizes.badge.md,
    height: sizes.badge.md,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  notes: {
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
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  referencePressed: {
    opacity: opacity.pressed,
  },
  referenceText: {
    ...typography.captionStrong,
    color: colors.text,
  },
});
