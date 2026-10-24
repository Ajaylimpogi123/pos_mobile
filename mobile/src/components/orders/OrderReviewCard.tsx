import { StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { Icon } from '@/components/ui/Icon';
import { IconBadge } from '@/components/ui/IconBadge';
import { Input } from '@/components/ui/Input';
import { colors, iconSizes, spacing, typography } from '@/constants/theme';
import type { OrderReviewState } from '@/hooks/orders/useOrderReview';
import { useResponsive } from '@/hooks/useResponsive';
import { REVIEW_NOTE_MAX, reviewReasonLabel } from '@pos/core/sale/reviewReasons';
import type { PrintableOrder } from '@/services/types';
import { formatClockTime, formatShortDate } from '@/utils/dates';

type OrderReviewCardProps = {
  order: PrintableOrder;
  review: OrderReviewState;
};

function reviewedWhen(iso: string): string {
  const time = formatClockTime(iso);
  return Number.isNaN(Date.parse(iso)) ? iso : `${formatShortDate(new Date(iso))}${time ? `, ${time}` : ''}`;
}

/**
 * An offline sale the server flagged (Offline Sales → Orders module →
 * Review): the reasons in plain words, then who reviewed it, or **Mark
 * reviewed** (`order.review`). Nothing shows for an order that was never flagged.
 */
export function OrderReviewCard({ order, review }: OrderReviewCardProps) {
  if (!order.needs_review && order.review_reasons.length === 0) return null;
  const reviewed = !order.needs_review;

  return (
    <Card style={styles.card} testID="order-review">
      <View style={styles.header}>
        <Icon
          name={reviewed ? 'checkmark-done-outline' : 'flag-outline'}
          size={iconSizes.md}
          color={reviewed ? colors.successText : colors.warningText}
        />
        <Text style={styles.title} accessibilityRole="header">
          {reviewed ? 'Reviewed' : 'Needs review'}
        </Text>
      </View>
      <View style={styles.reasons}>
        {order.review_reasons.map((reason) => (
          <Text key={reason} style={styles.reason} testID={`order-review-reason-${reason}`}>
            • {reviewReasonLabel(reason)}
          </Text>
        ))}
      </View>
      {reviewed && order.reviewed_by ? (
        <Text style={styles.meta} testID="order-reviewed-by">
          Reviewed by {order.reviewed_by.name}
          {order.reviewed_at ? ` · ${reviewedWhen(order.reviewed_at)}` : ''}
        </Text>
      ) : null}
      {review.available ? (
        <Button
          title="Mark reviewed"
          leftIcon="checkmark-done-outline"
          onPress={review.request}
          testID="order-mark-reviewed"
        />
      ) : null}
    </Card>
  );
}

/** "Mark reviewed" with an optional note (max 255). */
export function OrderReviewDialog({ review }: { review: OrderReviewState }) {
  const { isCompactHeight } = useResponsive();

  return (
    <DialogFrame visible={review.open} onRequestClose={review.cancel} busy={review.submitting} testID="review-dialog">
      {isCompactHeight ? null : <IconBadge icon="checkmark-done-outline" />}
      <Text style={styles.dialogTitle} accessibilityRole="header">
        Mark reviewed
      </Text>
      <Text style={styles.message}>The sale stays as it is; the reasons are kept for the record.</Text>
      {review.error ? <Banner message={review.error} testID="review-error" /> : null}
      <Input
        label="Note (optional)"
        value={review.note}
        onChangeText={review.setNote}
        error={review.noteError}
        placeholder="e.g. Checked with the cashier"
        maxLength={REVIEW_NOTE_MAX}
        multiline
        editable={!review.submitting}
        testID="review-note"
      />
      <View style={styles.actions}>
        <Button
          title="Mark reviewed"
          leftIcon="checkmark-done-outline"
          onPress={review.submit}
          loading={review.submitting}
          disabled={review.submitting}
          testID="review-submit"
        />
        <Button title="Cancel" variant="ghost" onPress={review.cancel} disabled={review.submitting} testID="review-cancel" />
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flex: 1,
  },
  reasons: {
    gap: spacing.xs,
  },
  reason: {
    ...typography.body,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dialogTitle: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
