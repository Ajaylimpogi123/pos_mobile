import { useEffect, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import { offlineRepository, type LocalOrderFilter, type LocalOrderRecord } from '@/db/offlineRepository';
import type { OrderSummary, PaymentMethod, PrintableOrder } from '@/services/types';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** An `OrderSummary` built on the device from a local order (no invoice number yet). */
export type LocalOrderSummary = Omit<OrderSummary, 'invoice_no'> & { invoice_no: string | null };

/** The unsynced states a local order shows in Orders with a badge. */
export type LocalOrderBadge = 'pending' | 'needs_attention';

/** The `OrderSummary` fields of a local order: `items_count` = Σ qty, `payment_methods` distinct and A→Z. */
export function localSummaryOf(order: PrintableOrder): LocalOrderSummary {
  const methods = [...new Set(order.payments.map((payment) => payment.method))].sort() as PaymentMethod[];
  return {
    ulid: order.ulid,
    invoice_no: order.invoice_no,
    queue_no: order.queue_no,
    table_no: order.table_no,
    business_date: order.business_date,
    status: order.status,
    placed_at: order.placed_at,
    cashier: order.cashier,
    customer: order.customer,
    items_count: order.items.reduce((sum, item) => sum + item.qty, 0),
    total_cents: order.total_cents,
    payment_methods: methods,
    refunded_cents: order.refunded_cents ?? 0,
    // Senior Citizen / PWD Discount (an order stored before it has no `sc_pwd`).
    has_sc_pwd: order.sc_pwd != null,
    order_no: order.order_no,
    source: order.source,
    needs_review: order.needs_review,
    review_reasons: order.review_reasons,
    reviewed_at: order.reviewed_at,
    reviewed_by: order.reviewed_by,
    synced_at: order.synced_at,
    shift_ulid: order.shift_ulid,
  };
}

const NO_RECORDS: LocalOrderRecord[] = [];

async function readLocal(filter: LocalOrderFilter): Promise<LocalOrderRecord[]> {
  try {
    if (!(await prepareDatabase())) return [];
    return await offlineRepository.listLocalOrders(filter);
  } catch {
    return [];
  }
}

/**
 * The local orders Orders shows at the top of a day's list (Offline Sales →
 * Orders module): this branch's `pending` and `needs_attention` sales of that
 * business date (every date with `null`), newest first. Like the server's
 * visibility rule, without `report.view` only the user's own sales. Re-read
 * whenever the outbox changes. Empty when `enabled` is false or SQLite can't open.
 */
export function useLocalOrders(businessDate: string | null, enabled: boolean): LocalOrderRecord[] {
  const user = useSessionStore((state) => state.user);
  const localVersion = useOfflineStore((state) => state.localVersion);
  const branchId = user?.branch.id ?? null;
  const cashierId = user && !hasPermission(user, PERMISSIONS.reportView) ? user.id : null;
  // The rows are kept with the filter they were read for: another day never shows the last day's rows.
  const key = `${businessDate ?? 'all'}|${branchId ?? ''}|${cashierId ?? ''}`;
  const [loaded, setLoaded] = useState<{ key: string; records: LocalOrderRecord[] }>({ key: '', records: NO_RECORDS });

  useEffect(() => {
    if (!enabled || branchId === null) return;
    let active = true;
    void readLocal({
      statuses: ['pending', 'needs_attention'],
      businessDate: businessDate ?? undefined,
      branchId,
      cashierId: cashierId ?? undefined,
    }).then((rows) => {
      if (active) setLoaded({ key, records: rows });
    });
    return () => {
      active = false;
    };
  }, [enabled, key, businessDate, branchId, cashierId, localVersion]);

  return enabled && branchId !== null && loaded.key === key ? loaded.records : NO_RECORDS;
}

/** One local order by ULID (`loading` until SQLite has answered; `record` null when not stored here). */
export function useLocalOrder(ulid: string | null): { loading: boolean; record: LocalOrderRecord | null } {
  const localVersion = useOfflineStore((state) => state.localVersion);
  const [state, setState] = useState<{ ulid: string | null; record: LocalOrderRecord | null }>({ ulid: null, record: null });

  useEffect(() => {
    if (ulid === null) return;
    let active = true;
    void (async () => {
      let record: LocalOrderRecord | null = null;
      try {
        if (await prepareDatabase()) record = await offlineRepository.getLocalOrder(ulid);
      } catch {
        record = null;
      }
      if (active) setState({ ulid, record });
    })();
    return () => {
      active = false;
    };
  }, [ulid, localVersion]);

  return { loading: ulid !== null && state.ulid !== ulid, record: state.ulid === ulid ? state.record : null };
}
