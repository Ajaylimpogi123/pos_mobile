/**
 * Purchasing wording (Ingredients, Recipes & Purchasing §E–§H and §L): the
 * statuses of PRs, POs, receiving, lines and decisions, the timeline actions
 * and the self-approval message. Mirrors the tablet's
 * `mobile/src/components/purchasing/purchasingLabels.ts` word for word; only
 * the chip variants become the web's MASTER §1.3 status tones and the icons
 * become lucide icons. The offline message is left out (the web is online-only).
 */
import {
  CheckCheck,
  CircleCheck,
  CircleDot,
  CircleX,
  ClipboardList,
  Clock,
  FilePlus,
  PackageCheck,
  Pencil,
  type LucideIcon,
} from 'lucide-react';

import type { StatusInfo } from '@/constants/inventoryLabels';
import type {
  PurchaseDecision,
  PurchaseLineReceivingStatus,
  PurchaseOrderReceivingStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '@/services/types';

/** §E: the self-approval 403 (the server's message is shown; this is the fallback). */
export const SELF_APPROVAL_MESSAGE = 'Someone else must approve your own request.';

/** A status label and its MASTER §1.3 tone; `neutral` (Cancelled, unknown values) is a plain badge with a dot. */
export type PurchaseStatusInfo = { label: string; tone: StatusInfo['tone'] | 'neutral' };

export const PR_STATUS: Record<PurchaseRequestStatus, PurchaseStatusInfo> = {
  pending_approval: { label: 'Pending Approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  partially_approved: { label: 'Partially Approved', tone: 'info' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const PO_STATUS: Record<PurchaseOrderStatus, PurchaseStatusInfo> = {
  pending_approval: { label: 'Pending Approval', tone: 'warning' },
  approved: { label: 'Approved · Ready for Receiving', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
};

export const PO_RECEIVING_STATUS: Record<PurchaseOrderReceivingStatus, PurchaseStatusInfo> = {
  not_received: { label: 'Not Received', tone: 'warning' },
  partially_received: { label: 'Partially Received', tone: 'info' },
  fully_received: { label: 'Fully Received', tone: 'success' },
};

/** Line status: `Over-received` is a caution (§L). */
export const LINE_STATUS: Record<PurchaseLineReceivingStatus, PurchaseStatusInfo> = {
  pending: { label: 'Pending', tone: 'warning' },
  partial: { label: 'Partial', tone: 'info' },
  complete: { label: 'Complete', tone: 'success' },
  over_received: { label: 'Over-received', tone: 'warning' },
};

export const DECISION: Record<PurchaseDecision, PurchaseStatusInfo & { icon: LucideIcon }> = {
  pending: { label: 'Pending', tone: 'warning', icon: Clock },
  approved: { label: 'Approved', tone: 'success', icon: CircleCheck },
  declined: { label: 'Declined', tone: 'danger', icon: CircleX },
};

/** The info for any status value, with a neutral fallback for a value this build doesn't know. */
export function statusFor<K extends string>(map: Record<K, PurchaseStatusInfo>, value: string | null | undefined): PurchaseStatusInfo {
  if (value && Object.prototype.hasOwnProperty.call(map, value)) return map[value as K];
  return { label: value ?? '—', tone: 'neutral' };
}

/** Timeline wording per audit action (an unknown action shows as is). */
const TIMELINE_ACTIONS: Readonly<Record<string, { label: string; icon: LucideIcon }>> = {
  'pr.created': { label: 'Request created', icon: FilePlus },
  'pr.updated': { label: 'Request edited', icon: Pencil },
  'pr.cancelled': { label: 'Request cancelled', icon: CircleX },
  'pr.item_approved': { label: 'Item approved', icon: CircleCheck },
  'pr.item_declined': { label: 'Item declined', icon: CircleX },
  'po.created': { label: 'Purchase order created', icon: ClipboardList },
  'po.updated': { label: 'Purchase order edited', icon: Pencil },
  'po.approved': { label: 'Purchase order approved', icon: CheckCheck },
  'po.declined': { label: 'Purchase order declined', icon: CircleX },
  'po.received': { label: 'Goods received', icon: PackageCheck },
};

export function timelineAction(action: string): { label: string; icon: LucideIcon } {
  return TIMELINE_ACTIONS[action] ?? { label: action, icon: CircleDot };
}
