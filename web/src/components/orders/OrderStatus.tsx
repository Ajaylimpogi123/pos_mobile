/**
 * Order status badges (MASTER §1.3: dot + word on the status tint). The words
 * are the shared ones (`@pos/core/sale/reversals`), as on the tablet.
 */
import { StatusBadge } from '@/components/ui/badge';
import type { OrderStatus } from '@/services/types';
import { orderStatusLabel } from '@pos/core/sale/reversals';

const TONES: Record<OrderStatus, 'success' | 'danger' | 'info'> = {
  completed: 'success',
  voided: 'danger',
  refunded: 'info',
  partially_refunded: 'info',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <StatusBadge tone={TONES[status] ?? 'info'} label={orderStatusLabel(status)} />;
}

export function NeedsReviewBadge() {
  return <StatusBadge tone="warning" label="Needs review" />;
}
