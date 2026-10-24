/**
 * Dine-in Tables & Tabs §F: what a tab print job stores in `order_json`
 * (rendered at send time with the current config, like every job).
 *
 * - `tab_round` (one per station): the round's lines routed there by
 *   `item_ids`; `order_ulid` is the round's ULID, so a replayed `200` never
 *   prints the round twice; `queue_no` is the round number.
 * - `tab_void` (one per station): the cancelled quantity; `order_ulid` is the
 *   cancel's `Idempotency-Key`; `queue_no` is 0.
 * - `bill` (receipt printer): the remaining items at print time; a new
 *   `order_ulid` each time (a bill prints as often as asked); `queue_no` is 0.
 */
import type { Tab, TabItem } from '@/services/types';

export type TabRoundDocument = {
  tab: Pick<Tab, 'ulid' | 'table' | 'guests' | 'notes'>;
  /** Only this round's lines. */
  items: TabItem[];
  round_no: number;
  server_name: string;
  sent_at: string;
};

export type TabVoidDocument = {
  tab: Pick<Tab, 'ulid' | 'table'>;
  /** The cancelled line, `qty` = the cancelled quantity. */
  items: TabItem[];
  cancelled_at: string;
};

export type BillDocument = {
  tab: Pick<Tab, 'ulid' | 'table' | 'guests' | 'items'>;
  /** ms. */
  printed_at: number;
  service_charge_bps: number;
  split_count: number | null;
};
