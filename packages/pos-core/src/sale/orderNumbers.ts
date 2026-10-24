/**
 * Order-number helpers shared by the tablet and the web POS: the contract's
 * `order_no` rule and the labels printed documents and screens use.
 */
import type { PrintableOrder } from '../contract/types';

/** The contract's `order_no` rule. */
export const ORDER_NO_PATTERN = /^[A-Z0-9]{1,8}-\d{8}-\d{4,6}$/;

export type ParsedOrderNo = { deviceCode: string; date: string; sequence: number };

/** `T01-20260926-0005` → `{ deviceCode: 'T01', date: '2026-09-26', sequence: 5 }`; `null` when malformed. */
export function parseOrderNo(orderNo: string): ParsedOrderNo | null {
  if (!ORDER_NO_PATTERN.test(orderNo)) return null;
  const [deviceCode, ymd, sequence] = orderNo.split('-');
  return {
    deviceCode,
    date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    sequence: Number(sequence),
  };
}

/** The kitchen's short number of an offline sale: `T01-20260926-0005` → `T01-5` (code + sequence). */
export function shortOrderNumber(orderNo: string): string {
  const parsed = parseOrderNo(orderNo);
  return parsed ? `${parsed.deviceCode}-${parsed.sequence}` : orderNo;
}

/**
 * The number an order is known by on screen and on paper: the invoice number,
 * or, for a local order, `T01-20260926-0005 (offline)`.
 */
export function orderNumberLabel(order: Pick<PrintableOrder, 'invoice_no' | 'order_no'>): string {
  if (order.invoice_no !== null) return order.invoice_no;
  return order.order_no ? `${order.order_no} (offline)` : '(offline)';
}

/** The big number on a kitchen ticket: `#17`, or `T01-5` for a local order. */
export function ticketNumberLabel(order: Pick<PrintableOrder, 'invoice_no' | 'order_no' | 'queue_no'>): string {
  if (order.invoice_no === null && order.order_no) return shortOrderNumber(order.order_no);
  return `#${order.queue_no}`;
}
