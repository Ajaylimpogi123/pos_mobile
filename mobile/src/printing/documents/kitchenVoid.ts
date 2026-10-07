/**
 * The VOID kitchen ticket (docs/api-contract.md → Voids & Refunds (Phase 7)
 * → Printing): one per station the sale's lines route to (as for kitchen
 * tickets), when `print_kitchen_tickets` is on. No prices.
 *
 * ```
 * <printer name>
 * *** VOID ***                 (centred, double size)
 * #17  (or T01-5 for an offline sale)
 * INV-MAIN-00000042  12:20 PM
 * --------------------------------
 * 2 x Rice Cake    (the station's lines, as on the kitchen ticket)
 * --------------------------------
 * Do not prepare
 * ```
 */
import { shortOrderNumber } from '@/sale/localOrder';
import type { Order, OrderItem } from '@/services/types';

import { EscPosBuilder } from '../escpos/builder';
import { formatPrintedTime } from './format';
import { mergeTicketLines } from './kitchenTicket';
import { REPRINT_MARK } from './receipt';

export type KitchenVoidOptions = {
  /** The station's printer name, printed as the title. */
  printerName: string;
  /** The order's lines routed to this station. */
  items: readonly OrderItem[];
  columns: number;
  timeZone: string;
  reprint?: boolean;
};

/**
 * The number the kitchen called: `#17`, or for a sale made offline the
 * `T01-5` its ticket showed (the server `Order` keeps its `order_no`).
 */
export function kitchenNumberOf(order: Pick<Order, 'source' | 'order_no' | 'queue_no'>): string {
  if (order.source === 'offline' && order.order_no) return shortOrderNumber(order.order_no);
  return `#${order.queue_no}`;
}

/** The VOID ticket for one station, as ESC/POS bytes ending in a cut. */
export function buildKitchenVoid(order: Order, options: KitchenVoidOptions): Uint8Array {
  const builder = new EscPosBuilder(options.columns).init();
  builder.align('center').bold(true).wrapped(options.printerName.toUpperCase()).bold(false);
  builder.size(2, 2).line('*** VOID ***').size(1, 1);
  if (options.reprint) builder.line(REPRINT_MARK);
  builder.size(2, 2).line(kitchenNumberOf(order)).size(1, 1).align('left');
  builder.joined([order.invoice_no, order.voided_at ? formatPrintedTime(order.voided_at, options.timeZone) : '']);
  builder.divider();

  for (const line of mergeTicketLines(options.items)) {
    builder.bold(true).size(1, 2).wrapped(`${line.qty} x ${line.product_name}`, 4).size(1, 1).bold(false);
    if (line.notes) builder.wrapped(`  > ${line.notes}`, 4);
  }
  builder.divider();
  builder.bold(true).line('Do not prepare').bold(false);
  return builder.cut().build();
}
