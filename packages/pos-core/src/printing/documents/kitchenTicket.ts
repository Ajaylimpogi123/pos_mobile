/**
 * A kitchen or bar ticket (docs/api-contract.md → Printing → Kitchen ticket):
 * no prices. One ticket per station, with the lines that have the same
 * `(product_id, notes)` merged into one.
 */
import { ticketNumberLabel } from '../../sale/orderNumbers';
import type { OrderItem, PrintableOrder, Tab, TabItem } from '../../contract/types';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedTime } from './format';
import { REPRINT_MARK } from './receipt';

/** One printed ticket line. */
export type TicketLine = {
  product_id: number;
  product_name: string;
  qty: number;
  notes: string | null;
};

/**
 * Merges the lines with the same `(product_id, notes)`, adding up `qty`.
 * Each merged line keeps the position of its first occurrence (the order of sale).
 * Sale order is the contract rule (Q-006, resolved): the layout example is illustrative only.
 */
export function mergeTicketLines(items: readonly Pick<OrderItem, 'product_id' | 'product_name' | 'qty' | 'notes'>[]): TicketLine[] {
  const merged = new Map<string, TicketLine>();
  for (const item of items) {
    const notes = item.notes === null || item.notes.trim() === '' ? null : item.notes;
    const key = `${item.product_id}\u0000${notes ?? ''}`;
    const existing = merged.get(key);
    if (existing) existing.qty += item.qty;
    else merged.set(key, { product_id: item.product_id, product_name: item.product_name, qty: item.qty, notes });
  }
  return [...merged.values()];
}

export type KitchenTicketOptions = {
  /** The station's printer name, printed as the title ("KITCHEN"). */
  printerName: string;
  /** The order's lines routed to this station. */
  items: readonly OrderItem[];
  columns: number;
  timeZone: string;
  reprint?: boolean;
};

/** The ticket for one station, as ESC/POS bytes ending in a cut. */
export function buildKitchenTicket(order: PrintableOrder, options: KitchenTicketOptions): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  builder.align('center').bold(true).wrapped(options.printerName.toUpperCase()).bold(false).align('left');
  if (options.reprint) builder.line(REPRINT_MARK);
  // Offline Sales: a local order's big number is `T01-5` (device code + daily sequence) in place of `#queue`.
  builder.align('center').size(2, 2).line(ticketNumberLabel(order));
  // Table Number (Core Sale revision 2): large, right under the queue number, only when set.
  if (order.table_no) builder.wrapped(`TABLE ${order.table_no}`);
  builder.size(1, 1).align('left');
  builder.joined([order.invoice_no ?? order.order_no ?? '', formatPrintedTime(order.placed_at, options.timeZone)]);
  builder.wrapped(`Cashier: ${order.cashier.name}`, 2);
  builder.divider();

  for (const line of mergeTicketLines(options.items)) {
    builder.bold(true).size(1, 2).wrapped(`${line.qty} x ${line.product_name}`, 4).size(1, 1).bold(false);
    if (line.notes) builder.wrapped(`  > ${line.notes}`, 4);
  }
  builder.divider();

  if (order.notes) builder.wrapped(`Note: ${order.notes}`, 2);
  return builder.cut().build();
}

/** `ROUND 2 · 3 guests` (`1 guest` in the singular). */
export function roundLine(roundNo: number, guests: number): string {
  return `ROUND ${roundNo} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`;
}

export type TabRoundTicketOptions = {
  /** The station's printer name, printed as the title ("KITCHEN"). */
  printerName: string;
  /** The round's lines routed to this station (only this round's items). */
  items: readonly Pick<TabItem, 'product_id' | 'product_name' | 'qty' | 'notes'>[];
  roundNo: number;
  /** The server who sent the round. */
  serverName: string;
  /** When the round was sent (ISO 8601). */
  sentAt: string;
  columns: number;
  timeZone: string;
  reprint?: boolean;
};

/**
 * Dine-in Tables & Tabs §F: the kitchen ticket of one round, for one station.
 * The existing layout with `TABLE 5` in double size, then `ROUND 2 · 3 guests`,
 * the server's name, and the round's items only. No prices.
 */
export function buildTabRoundTicket(tab: Pick<Tab, 'table' | 'guests' | 'notes'>, options: TabRoundTicketOptions): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  builder.align('center').bold(true).wrapped(options.printerName.toUpperCase()).bold(false).align('left');
  if (options.reprint) builder.line(REPRINT_MARK);
  builder.align('center').size(2, 2).wrapped(`TABLE ${tab.table.name}`).size(1, 1);
  builder.bold(true).line(roundLine(options.roundNo, tab.guests)).bold(false).align('left');
  builder.joined([`Server: ${options.serverName}`, formatPrintedTime(options.sentAt, options.timeZone)]);
  builder.divider();

  for (const line of mergeTicketLines(options.items)) {
    builder.bold(true).size(1, 2).wrapped(`${line.qty} x ${line.product_name}`, 4).size(1, 1).bold(false);
    if (line.notes) builder.wrapped(`  > ${line.notes}`, 4);
  }
  builder.divider();

  if (tab.notes) builder.wrapped(`Note: ${tab.notes}`, 2);
  return builder.cut().build();
}
