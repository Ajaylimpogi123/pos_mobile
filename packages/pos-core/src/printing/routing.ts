/**
 * Where a sale prints (docs/api-contract.md → Printing → Routing). Pure:
 * config and order in, a plan out.
 *
 * - **Receipt printer:** this tablet's own choice among the enabled `cashier`
 *   printers, else the only enabled one, else the first by name. With none,
 *   there is no receipt (the success screen says so).
 * - **Copies:** `auto_print_receipt` on → `receipt_copies` receipts; off → none
 *   now, and a "Print receipt" button.
 * - **Kitchen and bar:** each item goes to the enabled kitchen or bar printer
 *   its category is routed to, else to the enabled default kitchen printer,
 *   else it is **not sent to any printer**. One ticket per station. When
 *   `print_kitchen_tickets` is off, no tickets print automatically (and nothing
 *   is "unrouted"). A manual reprint ignores the setting (Q-007, resolved).
 */
import type { Order, OrderItem, PrintConfig, Printer } from '../contract/types';

/** Printers by name (case-insensitive), then id: the order print-config already uses. */
export function sortPrinters(printers: readonly Printer[]): Printer[] {
  return [...printers].sort((a, b) => {
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return byName !== 0 ? byName : a.id - b.id;
  });
}

export function isTicketPrinter(printer: Printer): boolean {
  return printer.role === 'kitchen' || printer.role === 'bar';
}

/** Enabled receipt (`cashier`) printers, by name. */
export function receiptPrinters(printers: readonly Printer[]): Printer[] {
  return sortPrinters(printers.filter((printer) => printer.role === 'cashier' && printer.is_enabled));
}

/** This tablet's receipt printer (see the module notes), or `null` when there is none. */
export function chooseReceiptPrinter(printers: readonly Printer[], preferredId: number | null): Printer | null {
  const candidates = receiptPrinters(printers);
  return candidates.find((printer) => printer.id === preferredId) ?? candidates[0] ?? null;
}

/** The enabled station an item's category goes to, or `null`. */
export function stationFor(item: Pick<OrderItem, 'category_id'>, printers: readonly Printer[]): Printer | null {
  const stations = sortPrinters(printers.filter((printer) => isTicketPrinter(printer) && printer.is_enabled));
  const routed = stations.find((printer) => printer.category_ids.includes(item.category_id));
  if (routed) return routed;
  return stations.find((printer) => printer.is_default_kitchen) ?? null;
}

export type StationTicket = {
  printer: Printer;
  /** The order's lines for this station, in the order of sale (merged when printed). */
  items: OrderItem[];
};

export type KitchenRouting = {
  tickets: StationTicket[];
  /** Lines no enabled printer takes. */
  unrouted: OrderItem[];
};

/**
 * Splits the order's lines into one ticket per station (stations by name).
 * `manual`: an explicit Reprint → Kitchen tickets, which prints even when
 * `print_kitchen_tickets` is off (the setting governs automatic printing only; Q-007).
 */
export function routeKitchen(
  order: Pick<Order, 'items'>,
  config: Pick<PrintConfig, 'printers' | 'settings'>,
  options: { manual?: boolean } = {},
): KitchenRouting {
  return routeTicketLines(order.items, config, options);
}

/** One station's lines of any kind (order items, or a tab round's items). */
export type StationLines<T> = { printer: Printer; items: T[] };

/**
 * `routeKitchen` for any lines that carry a `category_id` (Dine-in: a tab
 * round's items, or a cancelled tab item): the same routing and the same
 * `print_kitchen_tickets` rule.
 */
export function routeTicketLines<T extends Pick<OrderItem, 'category_id'>>(
  items: readonly T[],
  config: Pick<PrintConfig, 'printers' | 'settings'>,
  options: { manual?: boolean } = {},
): { tickets: StationLines<T>[]; unrouted: T[] } {
  if (!options.manual && !config.settings.print_kitchen_tickets) return { tickets: [], unrouted: [] };

  const byPrinter = new Map<number, StationLines<T>>();
  const unrouted: T[] = [];
  for (const item of items) {
    const printer = stationFor(item, config.printers);
    if (!printer) {
      unrouted.push(item);
      continue;
    }
    const ticket = byPrinter.get(printer.id) ?? { printer, items: [] };
    ticket.items.push(item);
    byPrinter.set(printer.id, ticket);
  }
  const tickets = sortPrinters([...byPrinter.values()].map((ticket) => ticket.printer)).map(
    (printer) => byPrinter.get(printer.id) as StationLines<T>,
  );
  return { tickets, unrouted };
}

export type SalePrintPlan = {
  receiptPrinter: Printer | null;
  /** Receipts to print now: `receipt_copies` when auto-print is on and there is a printer, else 0. */
  receiptCopies: number;
  /** Auto-print is off: the success screen offers "Print receipt". */
  manualReceipt: boolean;
  tickets: StationTicket[];
  unrouted: OrderItem[];
};

/** The whole plan for a completed sale. */
export function planSale(order: Pick<Order, 'items'>, config: PrintConfig, preferredReceiptPrinterId: number | null): SalePrintPlan {
  const receiptPrinter = chooseReceiptPrinter(config.printers, preferredReceiptPrinterId);
  const auto = config.settings.auto_print_receipt;
  const copies = Math.max(1, Math.min(3, Math.trunc(config.settings.receipt_copies)));
  const kitchen = routeKitchen(order, config);
  return {
    receiptPrinter,
    receiptCopies: receiptPrinter && auto ? copies : 0,
    manualReceipt: !auto,
    tickets: kitchen.tickets,
    unrouted: kitchen.unrouted,
  };
}
