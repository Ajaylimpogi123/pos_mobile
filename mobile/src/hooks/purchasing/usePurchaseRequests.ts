import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { purchaseOrderKeys, purchaseRequestKeys } from '@/hooks/purchasing/queryKeys';
import { useAfterPurchasingWrite, usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useKeyedCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { cancelPurchaseRequest, decidePurchaseRequest, getPurchaseRequest, listPurchaseRequests } from '@/services/purchasing';
import type { PurchaseDecisionEntry, PurchaseRequest, PurchaseRequestListParams, PurchaseRequestStatus } from '@/services/types';

/** PRs per page. */
export const PURCHASE_PAGE_SIZE = 25;

/** Contract: a decline reason is required, max 255. */
export const DECISION_REASON_MAX = 255;

/** The list's views: every PR, the ones waiting on me (`needs_decision`), or mine (`mine`). */
export type PurchaseRequestView = 'all' | 'decision' | 'mine';

function prKey(pr: PurchaseRequest): string {
  return pr.ulid;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Purchase requests (`/purchasing/requests`): the `All · Needs my decision ·
 * Mine` view (`?view=decision` from the dashboard), the status chips, the
 * search (PR number or item name), and the cursor list, newest first.
 */
export function usePurchaseRequestListScreen() {
  const params = useLocalSearchParams<{ view?: string | string[] }>();
  const { canApprove } = usePurchasingPermissions();
  const [view, setView] = useState<PurchaseRequestView>(firstParam(params.view) === 'decision' && canApprove ? 'decision' : 'all');
  const [status, setStatus] = useState<PurchaseRequestStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const online = useIsOnline();
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const query = useMemo<PurchaseRequestListParams>(
    () => ({
      search: debounced === '' ? undefined : debounced,
      status: status === 'all' ? undefined : status,
      needs_decision: view === 'decision' ? true : undefined,
      mine: view === 'mine' ? true : undefined,
    }),
    [debounced, status, view],
  );

  const list = useKeyedCursorList<PurchaseRequest>({
    queryKey: purchaseRequestKeys.list(query),
    fetchPage: (cursor) => listPurchaseRequests({ ...query, per_page: PURCHASE_PAGE_SIZE, cursor }),
    keepPrevious: true,
    enabled: online,
    keyOf: prKey,
  });

  return {
    online,
    view,
    setView,
    showDecisionView: canApprove,
    status,
    setStatus,
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    filtersActive: debounced !== '' || status !== 'all' || view !== 'all',
    clearFilters: () => {
      setSearch('');
      setStatus('all');
      setView('all');
    },
    list,
  };
}

/** GET /api/v1/purchase-requests/{ulid} (with `timeline`). */
export function usePurchaseRequest(ulid: string | null) {
  return useQuery({
    queryKey: purchaseRequestKeys.detail(ulid ?? ''),
    queryFn: () => getPurchaseRequest(ulid as string),
    enabled: ulid !== null,
  });
}

/** No item decided yet (edit and cancel are allowed only then, §F). */
export function isUndecided(pr: PurchaseRequest): boolean {
  return pr.status === 'pending_approval' && pr.items.every((item) => item.decision === 'pending');
}

/** The decline dialog of one item: its reason (required, max 255). */
type DeclineState = { itemId: number; name: string; reason: string; error: string | null } | null;

/**
 * PR decisions (`purchase.approve`; §F): **Approve** / **Decline** per item
 * (decline asks for a reason), **Approve all remaining**, and **Cancel request**.
 * Each answer (200 with the PR) replaces the cached PR; a decision that
 * creates the PO also refreshes the PO lists. The self-approval 403, a 409
 * (`This item was already decided.`) and other errors show in the banner; a
 * 422 on the reason shows under it.
 */
export function usePurchaseRequestActions(pr: PurchaseRequest | null) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decline, setDecline] = useState<DeclineState>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const pending = pr?.items.filter((item) => item.decision === 'pending') ?? [];

  async function decide(key: string, decisions: PurchaseDecisionEntry[], success: string): Promise<boolean> {
    if (!pr || busy) return false;
    setBusy(key);
    setBanner(null);
    setNotice(null);
    try {
      const updated = await decidePurchaseRequest(pr.ulid, { decisions });
      client.setQueryData(purchaseRequestKeys.detail(pr.ulid), updated);
      if (updated.purchase_order) void client.invalidateQueries({ queryKey: purchaseOrderKeys.detail(updated.purchase_order.ulid) });
      afterWrite();
      setNotice(updated.purchase_order && !pr.purchase_order ? `${success} ${updated.purchase_order.po_no} was created.` : success);
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
      setNotice(`${pr.pr_no} was cancelled.`);
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
    notice,
    pendingCount: pending.length,
    approve: (itemId: number, name: string) =>
      void decide(`approve-${itemId}`, [{ item_id: itemId, decision: 'approved' }], `Approved “${name}”.`),
    decline: {
      state: decline,
      open: (itemId: number, name: string) => setDecline({ itemId, name, reason: '', error: null }),
      setReason: (reason: string) => setDecline((current) => (current ? { ...current, reason, error: null } : current)),
      submit: () => void submitDecline(),
      cancel: () => {
        if (!busy) setDecline(null);
      },
    },
    approveAll: {
      visible: confirmAll,
      open: () => setConfirmAll(true),
      cancel: () => {
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
      visible: confirmCancel,
      open: () => setConfirmCancel(true),
      cancel: () => {
        if (!busy) setConfirmCancel(false);
      },
      confirm: () => void cancel(),
    },
  };
}

export type PurchaseRequestActionsState = ReturnType<typeof usePurchaseRequestActions>;
