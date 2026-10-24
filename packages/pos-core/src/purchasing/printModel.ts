/**
 * Purchase Request & Order PDF (v1.24 §C/§D, v1.27 §G): the pure rules behind
 * the two printed documents, shared by the web print pages and the tablet's
 * HTML (`./printHtml`):
 * - the PR estimates and totals (`round_half_up(estimated_unit_price_cents × qty)`
 *   through `lineTotalCents`), and the approver line;
 * - the PO supplier grouping and the picker filter;
 * - the error wording (§E) and the footer text (§B).
 *
 * Platform-free: no React, DOM or storage. Tests live in
 * `mobile/src/purchasing/__tests__/printModel.test.ts`.
 */
import type { PurchaseOrder, PurchaseOrderLine, PurchaseRequestItem, SupplierRef, UserRef } from '../contract/types';
import { lineTotalCents } from '../quantity';

// ---------------------------------------------------------------------------
// Purchase request (§C)
// ---------------------------------------------------------------------------

/** §C: an item's estimated amount, or `null` ("—") when it has no price (or an unreadable qty). */
export function itemEstimateCents(item: PurchaseRequestItem): number | null {
  if (item.estimated_unit_price_cents === null) return null;
  return lineTotalCents(item.estimated_unit_price_cents, item.qty);
}

export type PrEstimateTotals = {
  /** Σ of every priced item's estimate; `null` when no item has a price. */
  totalCents: number | null;
  /** Σ of the approved priced items' estimates (0 when none). */
  approvedCents: number;
  /** Items without a price. */
  unpricedCount: number;
};

/** §C totals: all items, approved items, and the items without a price. */
export function prEstimateTotals(items: readonly PurchaseRequestItem[]): PrEstimateTotals {
  let total = 0;
  let approved = 0;
  let priced = 0;
  let unpriced = 0;
  for (const item of items) {
    const estimate = itemEstimateCents(item);
    if (estimate === null) {
      unpriced += 1;
      continue;
    }
    priced += 1;
    total += estimate;
    if (item.decision === 'approved') approved += estimate;
  }
  return { totalCents: priced === 0 ? null : total, approvedCents: approved, unpricedCount: unpriced };
}

/** §C: the approver when every decided item was decided by the same person; otherwise `null` (a blank line). */
export function commonApprover(items: readonly PurchaseRequestItem[]): UserRef | null {
  const decided = items.filter((item) => item.decision !== 'pending');
  if (decided.length === 0) return null;
  const first = decided[0]?.decided_by ?? null;
  if (!first) return null;
  return decided.every((item) => item.decided_by?.id === first.id) ? first : null;
}

// ---------------------------------------------------------------------------
// Purchase order (§D)
// ---------------------------------------------------------------------------

export type SupplierGroup = {
  supplier: SupplierRef;
  lines: PurchaseOrderLine[];
  /** Σ `line_total_cents` of the group's lines. */
  subtotalCents: number;
};

/** §D: the lines grouped by supplier, in the order each supplier first appears. */
export function groupLinesBySupplier(lines: readonly PurchaseOrderLine[]): SupplierGroup[] {
  const groups = new Map<number, SupplierGroup>();
  for (const line of lines) {
    const group = groups.get(line.supplier.id);
    if (group) {
      group.lines.push(line);
      group.subtotalCents += line.line_total_cents;
    } else {
      groups.set(line.supplier.id, { supplier: line.supplier, lines: [line], subtotalCents: line.line_total_cents });
    }
  }
  return [...groups.values()];
}

export type PoPrintSelection = {
  groups: SupplierGroup[];
  /** The picked supplier, or `null` for All suppliers. */
  only: SupplierRef | null;
  /** The total to print: the PO's `total_cents`, or the picked supplier's subtotal. */
  totalCents: number;
};

/**
 * §D.6: every group (All suppliers), or only the picked supplier's group. A
 * supplier id that isn't on the PO falls back to All suppliers.
 */
export function selectSupplierGroups(po: PurchaseOrder, supplierId: number | null): PoPrintSelection {
  const groups = groupLinesBySupplier(po.lines);
  const picked = supplierId === null ? undefined : groups.find((group) => group.supplier.id === supplierId);
  if (!picked) return { groups, only: null, totalCents: po.total_cents };
  return { groups: [picked], only: picked.supplier, totalCents: picked.subtotalCents };
}

/** `?supplier=<id>` → a positive integer id, or `null`. */
export function parseSupplierParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** §D.8: Received / Remaining are left out of a PO that hasn't received anything. */
export function showReceivedColumns(po: PurchaseOrder): boolean {
  return po.receiving_status !== 'not_received';
}

/** §D.1: the PO date is the first (earliest) timeline entry; `null` when there is none. */
export function poDate(po: PurchaseOrder): string | null {
  let earliest: { at: string; time: number } | null = null;
  for (const entry of po.timeline) {
    const time = Date.parse(entry.at);
    if (Number.isNaN(time)) continue;
    if (!earliest || time < earliest.time) earliest = { at: entry.at, time };
  }
  return earliest?.at ?? null;
}

// ---------------------------------------------------------------------------
// States (§E)
// ---------------------------------------------------------------------------

/** §E: the 403 wording. */
export const PRINT_FORBIDDEN_MESSAGE = "You don't have access to this document.";
/** §E: the 404 wording of a purchase request. */
export const PR_NOT_FOUND_MESSAGE = 'This request was not found.';
/** §E: the 404 wording of a purchase order. */
export const PO_NOT_FOUND_MESSAGE = 'This order was not found.';

/** §E: the wording of a failed read. 404 and 403 have their own message and no Retry. */
export function printErrorProps(
  status: number | null,
  message: string,
  notFound: string,
  retry: () => void,
): { message: string; onRetry?: () => void } {
  if (status === 404) return { message: notFound };
  if (status === 403) return { message: PRINT_FORBIDDEN_MESSAGE };
  return { message, onRetry: retry };
}

// ---------------------------------------------------------------------------
// Footer (§B)
// ---------------------------------------------------------------------------

/** The footer text before the page numbers: "Printed 12 Oct 2026, 3:04 PM by Ana · PR-MAIN-2026-00003". */
export function printFooterText(printedAt: string, userName: string, number: string): string {
  return `Printed ${printedAt}${userName !== '' ? ` by ${userName}` : ''} · ${number}`;
}
