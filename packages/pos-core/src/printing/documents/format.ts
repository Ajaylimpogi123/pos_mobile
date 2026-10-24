/**
 * Formatting shared by the printed documents. Times print in the **branch's
 * timezone** (from print-config, via `branchWallClock`), never the tablet's.
 * Amounts come from the server's `Order`; these helpers only format them.
 */
import { discountTypeLabel, formatPercentValue } from '../../sale/discountRules';
import type { PrinterRole, SaleDiscount } from '../../contract/types';
import { branchWallClock } from '../../businessDay';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clock(hour: number, minute: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad2(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "12:12 PM" in the branch's timezone. An unreadable timestamp prints as is. */
export function formatPrintedTime(iso: string, timeZone: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const local = branchWallClock(timeZone, time);
  return clock(local.hour, local.minute);
}

/** "09/25/2026 12:12 PM" in the branch's timezone (at `time`, ms). */
export function formatPrintedDateTimeAt(time: number, timeZone: string): string {
  const local = branchWallClock(timeZone, time);
  return `${pad2(local.month)}/${pad2(local.day)}/${local.year} ${clock(local.hour, local.minute)}`;
}

/** "09/25/2026 12:12 PM" for an ISO timestamp. An unreadable timestamp prints as is. */
export function formatPrintedDateTime(iso: string, timeZone: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : formatPrintedDateTimeAt(time, timeZone);
}

/** "Promo 10%" for a percent discount, "Promo" for an amount (the amount prints in the right column). */
export function printedDiscountLabel(discount: Pick<SaleDiscount, 'type' | 'kind' | 'value'>): string {
  const type = discountTypeLabel(discount.type);
  return discount.kind === 'percent' ? `${type} ${formatPercentValue(discount.value)}` : type;
}

const ROLE_LABELS: Record<PrinterRole, string> = {
  cashier: 'Receipt printer',
  kitchen: 'Kitchen',
  bar: 'Bar',
};

/** "Receipt printer", "Kitchen", "Bar". */
export function printerRoleLabel(role: PrinterRole): string {
  return ROLE_LABELS[role] ?? role;
}
