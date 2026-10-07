/**
 * Ingredients, Recipes & Purchasing §L wording: the status labels of PRs, POs,
 * receiving and lines, so each reads the same on every screen.
 */
import type { ChipVariant } from '@/components/ui/Chip';
import type { IconName } from '@/components/ui/Icon';
import type {
  PurchaseDecision,
  PurchaseLineReceivingStatus,
  PurchaseOrderReceivingStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '@/services/types';

/** Contract wording while the device has no connection (every purchasing screen needs one). */
export const PURCHASING_OFFLINE_MESSAGE = 'Purchasing needs a connection.';

/** §E: the self-approval 403 (the server's message is shown; this is the fallback). */
export const SELF_APPROVAL_MESSAGE = 'Someone else must approve your own request.';

type ChipInfo = { label: string; variant: ChipVariant };

export const PR_STATUS: Record<PurchaseRequestStatus, ChipInfo> = {
  pending_approval: { label: 'Pending Approval', variant: 'pending' },
  approved: { label: 'Approved', variant: 'completed' },
  partially_approved: { label: 'Partially Approved', variant: 'processing' },
  declined: { label: 'Declined', variant: 'cancelled' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

export const PO_STATUS: Record<PurchaseOrderStatus, ChipInfo> = {
  pending_approval: { label: 'Pending Approval', variant: 'pending' },
  approved: { label: 'Approved · Ready for Receiving', variant: 'completed' },
  declined: { label: 'Declined', variant: 'cancelled' },
};

export const PO_RECEIVING_STATUS: Record<PurchaseOrderReceivingStatus, ChipInfo> = {
  not_received: { label: 'Not Received', variant: 'pending' },
  partially_received: { label: 'Partially Received', variant: 'processing' },
  fully_received: { label: 'Fully Received', variant: 'completed' },
};

/** Line status: `Over-received` is a caution (§L). */
export const LINE_STATUS: Record<PurchaseLineReceivingStatus, ChipInfo> = {
  pending: { label: 'Pending', variant: 'pending' },
  partial: { label: 'Partial', variant: 'processing' },
  complete: { label: 'Complete', variant: 'completed' },
  over_received: { label: 'Over-received', variant: 'caution' },
};

export const DECISION: Record<PurchaseDecision, ChipInfo & { icon: IconName }> = {
  pending: { label: 'Pending', variant: 'pending', icon: 'time-outline' },
  approved: { label: 'Approved', variant: 'completed', icon: 'checkmark-circle-outline' },
  declined: { label: 'Declined', variant: 'cancelled', icon: 'close-circle-outline' },
};

/** A chip for any status value, with a neutral fallback for a value this build doesn't know. */
export function chipFor<K extends string>(map: Record<K, ChipInfo>, value: string | null | undefined): ChipInfo {
  if (value && Object.prototype.hasOwnProperty.call(map, value)) return map[value as K];
  return { label: value ?? '—', variant: 'neutral' };
}

/** Timeline wording per audit action (an unknown action shows as is). */
const TIMELINE_ACTIONS: Readonly<Record<string, { label: string; icon: IconName }>> = {
  'pr.created': { label: 'Request created', icon: 'create-outline' },
  'pr.updated': { label: 'Request edited', icon: 'pencil-outline' },
  'pr.cancelled': { label: 'Request cancelled', icon: 'close-circle-outline' },
  'pr.item_approved': { label: 'Item approved', icon: 'checkmark-circle-outline' },
  'pr.item_declined': { label: 'Item declined', icon: 'close-circle-outline' },
  'po.created': { label: 'Purchase order created', icon: 'clipboard-outline' },
  'po.updated': { label: 'Purchase order edited', icon: 'pencil-outline' },
  'po.approved': { label: 'Purchase order approved', icon: 'checkmark-done-outline' },
  'po.declined': { label: 'Purchase order declined', icon: 'close-circle-outline' },
  'po.received': { label: 'Goods received', icon: 'download-outline' },
};

export function timelineAction(action: string): { label: string; icon: IconName } {
  return TIMELINE_ACTIONS[action] ?? { label: action, icon: 'ellipse-outline' };
}
