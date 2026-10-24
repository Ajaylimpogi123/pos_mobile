/**
 * The count on a sidebar item (`AppModule.badge`): e.g. the sales that need
 * review. Hidden while unknown or zero. Status is never colour alone: the
 * number is spoken with its meaning.
 */
import { StatusBadge } from '@/components/ui/badge';
import type { ModuleBadge as ModuleBadgeKind } from '@/constants/modules';
import { useNeedsReviewCount } from '@/hooks/useOrders';

export function ModuleBadge({ kind, compact }: { kind: ModuleBadgeKind; compact: boolean }) {
  const needsReview = useNeedsReviewCount();
  if (kind !== 'needs_review' || !needsReview || needsReview.count === 0) return null;
  const text = needsReview.more ? `${needsReview.count}+` : String(needsReview.count);
  const spoken = `, ${text} ${needsReview.count === 1 && !needsReview.more ? 'sale needs' : 'sales need'} review`;
  if (compact) {
    return (
      <>
        <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-warning" />
        <span className="sr-only">{spoken}</span>
      </>
    );
  }
  return (
    <StatusBadge
      tone="warning"
      label={
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{spoken}</span>
        </>
      }
    />
  );
}
