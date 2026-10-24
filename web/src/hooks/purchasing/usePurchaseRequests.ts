/**
 * Purchase requests (§F), ported from the tablet's
 * `mobile/src/hooks/purchasing/usePurchaseRequests.ts` (same rules and wording):
 * the list (`All · Needs my decision · Mine`, status, search), the detail
 * (with `timeline`), and the actions: **Approve** / **Decline** per item
 * (decline asks for a reason), **Approve all remaining**, and **Cancel request**.
 * A decision that creates the PO also refreshes the PO lists. The
 * self-approval 403 and the 409s show in the banner; a 422 on the reason
 * shows under it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  PURCHASE_PAGE_SIZE,
  purchaseOrderKeys,
  purchaseRequestKeys,
  useAfterPurchasingWrite,
} from '@/hooks/purchasing/usePurchasingPermissions';
import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { cancelPurchaseRequest, decidePurchaseRequest, getPurchaseRequest, listPurchaseRequests } from '@/services/purchasing';
import type { PurchaseDecisionEntry, PurchaseRequest, PurchaseRequestListParams, PurchaseRequestStatus } from '@/services/types';

/** Contract: a decline reason is required, max 255. */
export const DECISION_REASON_MAX = 255;

/** The list's views: every PR, the ones waiting on me (`needs_decision`), or mine (`mine`). */
export type PurchaseRequestView = 'all' | 'decision' | 'mine';

export function usePurchaseRequestList(search: string, status: PurchaseRequestStatus | 'all', view: PurchaseRequestView) {
  const params = useMemo<PurchaseRequestListParams>(
    () => ({
      search: search === '' ? undefined : search,
      status: status === 'all' ? undefined : status,
      needs_decision: view === 'decision' ? true : undefined,
      mine: view === 'mine' ? true : undefined,
    }),
    [search, status, view],
  );
  return useCursorList(purchaseRequestKeys.list(params), (cursor) => listPurchaseRequests({ ...params, cursor, per_page: PURCHASE_PAGE_SIZE }));
}

/** GET /api/v1/purchase-requests/{ulid} (with `timeline`). */
export function usePurchaseRequest(ulid: string | null) {
  const query = useQuery({
    queryKey: purchaseRequestKeys.detail(ulid ?? ''),
    queryFn: () => getPurchaseRequest(ulid as string),
    enabled: ulid !== null,
  });
  return {
    pr: query.data ?? null,
    loading: ulid !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    /** The HTTP status of a failed read (404, 403…), or `null` (print views word 404 and 403 apart). */
    errorStatus: query.isError && isApiError(query.error) ? query.error.status : null,
    reload: () => void query.refetch(),
  };
}

/** No item decided yet (edit and cancel are allowed only then, §F). */
export function isUndecided(pr: PurchaseRequest): boolean {
  return pr.status === 'pending_approval' && pr.items.every((item) => item.decision === 'pending');
}

type DeclineState = { itemId: number; name: string; reason: string; error: string | null } | null;

export function usePurchaseRequestActions(pr: PurchaseRequest | null) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [decline, setDecline] = useState<DeclineState>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const pending = pr?.items.filter((item) => item.decision === 'pending') ?? [];

  async function decide(key: string, decisions: PurchaseDecisionEntry[], success: string): Promise<boolean> {
    if (!pr || busy) return false;
    setBusy(key);
    setBanner(null);
    try {
      const updated = await decidePurchaseRequest(pr.ulid, { decisions });
      client.setQueryData(purchaseRequestKeys.detail(pr.ulid), updated);
      if (updated.purchase_order) void client.invalidateQueries({ queryKey: purchaseOrderKeys.detail(updated.purchase_order.ulid) });
      afterWrite();
      // MASTER §6: a save success is a toast.
      toast.success(updated.purchase_order && !pr.purchase_order ? `${success} ${updated.purchase_order.po_no} was created.` : success);
      return true;
    } catch (error) {
      const reasonError = isApiValidationError(error)
        ? Object.entries(error.errors).find(([field]) => /^decisions\.\d+\.reason$/.test(field))?.[1]?.[0]
        : undefined;
      if (reasonError && decline) setDecline({ ...decline, error: reasonError });
      else setBanner(getErrorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitDecline() {
    if (!decline) return;
    const reason = decline.reason.trim();
    if (reason === '') {
      setDecline({ ...decline, error: 'Give a reason for declining.' });
      return;
    }
    if (reason.length > DECISION_REASON_MAX) {
      setDecline({ ...decline, error: `Use ${DECISION_REASON_MAX} characters or fewer.` });
      return;
    }
    const done = await decide(`decline-${decline.itemId}`, [{ item_id: decline.itemId, decision: 'declined', reason }], `Declined “${decline.name}”.`);
    if (done) setDecline(null);
  }

  async function cancel() {
    if (!pr || busy) return;
    setBusy('cancel');
    setBanner(null);
    try {
      await cancelPurchaseRequest(pr.ulid);
      await client.invalidateQueries({ queryKey: purchaseRequestKeys.detail(pr.ulid) });
      afterWrite();
      toast.success(`${pr.pr_no} was cancelled.`);
    } catch (error) {
      setBanner(getErrorMessage(error));
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  }

  return {
    busy,
    banner,
    pendingCount: pending.length,
    approve: (itemId: number, name: string) => void decide(`approve-${itemId}`, [{ item_id: itemId, decision: 'approved' }], `Approved “${name}”.`),
    decline: {
      state: decline,
      open: (itemId: number, name: string) => setDecline({ itemId, name, reason: '', error: null }),
      setReason: (reason: string) => setDecline((current) => (current ? { ...current, reason, error: null } : current)),
      submit: () => void submitDecline(),
      close: () => {
        if (!busy) setDecline(null);
      },
    },
    approveAll: {
      open: confirmAll,
      show: () => setConfirmAll(true),
      close: () => {
        if (!busy) setConfirmAll(false);
      },
      confirm: () => {
        void decide(
          'approve-all',
          pending.map((item) => ({ item_id: item.id, decision: 'approved' as const })),
          `Approved ${pending.length === 1 ? '1 item' : `${pending.length} items`}.`,
        ).finally(() => setConfirmAll(false));
      },
    },
    cancelRequest: {
      open: confirmCancel,
      show: () => setConfirmCancel(true),
      close: () => {
        if (!busy) setConfirmCancel(false);
      },
      confirm: () => void cancel(),
    },
  };
}

export type PurchaseRequestActionsState = ReturnType<typeof usePurchaseRequestActions>;
