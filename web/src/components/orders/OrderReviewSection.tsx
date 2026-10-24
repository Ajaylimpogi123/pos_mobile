/**
 * The order detail's review block (Offline Sales → Orders module → Review):
 * why the server flagged an offline sale, in plain words
 * (`@pos/core/sale/reviewReasons`), who reviewed it, and — for `order.review`
 * on a flagged order — **Mark reviewed** with an optional note.
 */
import { ClipboardCheckIcon, LoaderCircleIcon } from 'lucide-react';
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useOrderReview } from '@/hooks/useOrderReview';
import type { Order } from '@/services/types';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { REVIEW_NOTE_MAX, reviewReasonLabel } from '@pos/core/sale/reviewReasons';

/**
 * The plain-words reason. A reason the shared list doesn't know yet (a newer
 * server) is made readable here: "some_reason" → "Some reason".
 */
function reasonText(reason: string): string {
  const label = reviewReasonLabel(reason);
  if (label !== reason) return label;
  const words = reason.replace(/_/g, ' ').trim();
  return words === '' ? reason : words.charAt(0).toUpperCase() + words.slice(1);
}

export function OrderReviewSection({ order, timezone }: { order: Order; timezone: string }) {
  const review = useOrderReview(order);
  const reasons = order.review_reasons ?? [];
  if (!order.needs_review && reasons.length === 0 && !order.reviewed_at && !review.doneMessage) return null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    review.submit();
  }

  return (
    <section
      aria-label="Review"
      className={
        order.needs_review
          ? 'flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-bg p-3 text-sm'
          : 'flex flex-col gap-3 rounded-lg border border-border bg-subtle p-3 text-sm'
      }
    >
      <div className="flex flex-col gap-1">
        <p className={order.needs_review ? 'font-semibold text-warning' : 'font-semibold'}>
          {order.needs_review ? 'Needs review' : 'Reviewed'}
        </p>
        {reasons.length > 0 ? (
          <ul className="list-disc pl-5">
            {reasons.map((reason) => (
              <li key={reason}>{reasonText(reason)}</li>
            ))}
          </ul>
        ) : null}
        {order.reviewed_at ? (
          <p className="text-muted-foreground">
            Reviewed {formatBranchDateTime(order.reviewed_at, timezone) ?? order.reviewed_at}
            {order.reviewed_by ? ` by ${order.reviewed_by.name}` : ''}
          </p>
        ) : null}
        {order.synced_at && order.source === 'offline' ? (
          <p className="text-muted-foreground">Synced {formatBranchDateTime(order.synced_at, timezone) ?? order.synced_at}</p>
        ) : null}
      </div>

      {review.doneMessage ? <Banner variant="success">{review.doneMessage}</Banner> : null}
      {review.error && !review.open ? <Banner>{review.error}</Banner> : null}

      {review.available ? (
        review.open ? (
          <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate aria-busy={review.submitting}>
            <ErrorSummary />
            {review.error ? <Banner>{review.error}</Banner> : null}
            <FormField label="Note (optional)" error={review.noteError} hint={`Up to ${REVIEW_NOTE_MAX} characters.`}>
              <Textarea
                autoFocus
                value={review.note}
                maxLength={REVIEW_NOTE_MAX}
                onChange={(event) => review.setNote(event.target.value)}
                disabled={review.submitting}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="green" disabled={review.submitting}>
                {review.submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <ClipboardCheckIcon aria-hidden="true" />}
                {review.submitting ? 'Saving…' : 'Mark reviewed'}
              </Button>
              <Button variant="outline" onClick={review.cancel} disabled={review.submitting}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" className="w-fit" onClick={review.request}>
            <ClipboardCheckIcon aria-hidden="true" />
            Mark reviewed
          </Button>
        )
      ) : null}
    </section>
  );
}
