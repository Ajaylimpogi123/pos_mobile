/**
 * Purchase Request & Order PDF, revision 2 (v1.27 §G): the complete A4 HTML
 * document of one purchase request or one purchase order, built from
 * `./printModel`. The tablet hands it to `expo-print`; it reproduces the web
 * print pages (§B–§E) section for section:
 * - letterhead, title, number and status chips, the NOT APPROVED band;
 * - the details, the items (PR) or the supplier groups (PO), the totals and
 *   the signature lines;
 * - `@page { size: A4 portrait; margin: 14mm }` with the footer
 *   "Printed {date, time} by {user} · {number} · Page n of m" in the
 *   `@bottom-center` margin box. Engines without margin boxes keep the footer
 *   once at the end of the document instead (no page numbers): a small inline
 *   script hides that copy only on Chromium 131+ (which prints margin boxes),
 *   so with scripts off the end footer simply stays;
 * - a repeated `thead`, rows that never split across pages, and (All
 *   suppliers, several groups) each supplier group on a new page.
 *
 * Inline CSS only: no external fonts, images or links. Every value from the
 * API is HTML-escaped. Platform-free (a string in, a string out).
 */
import { formatBranchDateTime } from '../businessDay';
import type {
  PrintConfig,
  PurchaseDecision,
  PurchaseOrder,
  PurchaseOrderReceivingStatus,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestStatus,
  Supplier,
} from '../contract/types';
import { formatPeso } from '../money';
import { NO_VALUE } from '../numbers';
import { formatQty } from '../quantity';
import {
  commonApprover,
  itemEstimateCents,
  poDate,
  prEstimateTotals,
  printFooterText,
  selectSupplierGroups,
  showReceivedColumns,
  type SupplierGroup,
} from './printModel';

// ---------------------------------------------------------------------------
// Wording (the same labels as both apps' purchasing labels)
// ---------------------------------------------------------------------------

export const PR_STATUS_LABELS: Readonly<Record<PurchaseRequestStatus, string>> = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  partially_approved: 'Partially Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const PO_STATUS_LABELS: Readonly<Record<PurchaseOrderStatus, string>> = {
  pending_approval: 'Pending Approval',
  approved: 'Approved · Ready for Receiving',
  declined: 'Declined',
};

export const PO_RECEIVING_STATUS_LABELS: Readonly<Record<PurchaseOrderReceivingStatus, string>> = {
  not_received: 'Not Received',
  partially_received: 'Partially Received',
  fully_received: 'Fully Received',
};

export const DECISION_LABELS: Readonly<Record<PurchaseDecision, string>> = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
};

/** §C.6 / §D.7 band texts. */
export const PR_NOT_APPROVED_TEXT = 'NOT APPROVED — FOR REVIEW ONLY';
export const PO_NOT_APPROVED_TEXT = 'NOT APPROVED — DO NOT SEND TO SUPPLIER';

function labelOf<K extends string>(map: Readonly<Record<K, string>>, value: string): string {
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value as K] : value;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** `expo-print` page size for A4 at 72 PPI (its default is US Letter). */
export const A4_PAGE_POINTS = { width: 595, height: 842 } as const;

export type PrintDocumentContext = {
  /** The letterhead: the receipt header lines, or the branch name. */
  letterhead: string[];
  /** The branch timezone for dates and times. */
  timezone: string;
  /** "12 Oct 2026, 3:04 PM" in the branch's timezone. */
  printedAt: string;
  /** The signed-in user's name ("" leaves "by …" out). */
  userName: string;
};

/**
 * §B / §E: the print context from `print-config` (or `null` when its read
 * failed: it never blocks) and the signed-in user's branch as the fallback.
 */
export function buildPrintContext(input: {
  config: PrintConfig | null;
  fallbackBranchName: string;
  fallbackTimezone: string;
  userName: string;
  now: number;
}): PrintDocumentContext {
  const { config, fallbackBranchName, fallbackTimezone, userName, now } = input;
  const timezone = config?.branch.timezone ?? (fallbackTimezone !== '' ? fallbackTimezone : 'Asia/Manila');
  const headerLines = (config?.settings.receipt_header_lines ?? []).map((line) => line.trim()).filter((line) => line !== '');
  const branchName = config?.branch.name ?? fallbackBranchName;
  return {
    letterhead: headerLines.length > 0 ? headerLines : branchName !== '' ? [branchName] : [],
    timezone,
    printedAt: formatBranchDateTime(new Date(now).toISOString(), timezone) ?? '',
    userName,
  };
}

/** §B: the PDF file name is the document number: `PR-MAIN-2026-00003.pdf` (path characters replaced). */
export function printFileName(number: string): string {
  const safe = number.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe !== '' ? safe : 'document'}.pdf`;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A CSS string literal for `content:`: quotes and backslashes escaped, no line breaks, no `</`. */
function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ').replace(/</g, '\\3C ')}"`;
}

const e = escapeHtml;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Thu, 24 Sep 2026" for a `YYYY-MM-DD` business day (no timezone shift); the label itself when malformed. */
export function formatPrintBusinessDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return ymd;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${day} ${MONTHS[month - 1]} ${year}`;
}

function dateTime(iso: string, timezone: string): string {
  return formatBranchDateTime(iso, timezone) ?? iso;
}

/** Black on white with the brand green (MASTER §1.2) as the one accent; sizes as the web print view. */
const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#ffffff;color:#000000}
body{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:12px;line-height:1.375;-webkit-print-color-adjust:exact;print-color-adjust:exact}
p{margin:0}
.doc{display:flex;flex-direction:column;gap:20px}
.tabular{font-variant-numeric:tabular-nums}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;border-bottom:2px solid #15803d;padding-bottom:12px}
.letterhead{min-width:0}
.letterhead .l0{font-size:15px;font-weight:700}
.letterhead .ln{font-size:11px}
.title{display:flex;flex-direction:column;align-items:flex-end;gap:4px;text-align:right;flex-shrink:0}
.title h1{margin:0;font-size:18px;font-weight:700;letter-spacing:.025em;color:#15803d}
.title .number{font-size:13px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}
.chip{border:1px solid #000000;border-radius:9999px;padding:2px 8px;font-size:10px;font-weight:600;text-transform:uppercase}
.band{border:2px solid #000000;padding:6px 12px;text-align:center}
.band .t{font-size:12px;font-weight:700;letter-spacing:.025em}
.band .r{font-size:11px}
.details{display:grid;grid-template-columns:1fr 1fr;column-gap:32px;row-gap:8px;margin:0}
.details .entry{display:flex;gap:8px}
.details .full{grid-column:1 / span 2}
.details dt{width:128px;flex-shrink:0;font-weight:600}
.details dd{margin:0;min-width:0;overflow-wrap:anywhere}
.note{font-weight:600}
table{width:100%;border-collapse:collapse}
thead{display:table-header-group}
tr,.avoid{break-inside:avoid;page-break-inside:avoid}
th{border-bottom:2px solid #000000;padding:4px 6px;text-align:left;vertical-align:bottom;font-size:10px;font-weight:700;text-transform:uppercase}
td{border-bottom:1px solid rgba(0,0,0,.2);padding:4px 6px;vertical-align:top;overflow-wrap:anywhere}
.num{text-align:right;font-variant-numeric:tabular-nums}
tr.declined td{color:#4b5563}
.reason{display:block;font-style:italic}
.group{display:flex;flex-direction:column;gap:8px}
.group-break{break-before:page;page-break-before:always}
.supplier{border-left:4px solid #15803d;padding-left:12px}
.supplier .k{font-size:11px;font-weight:600;text-transform:uppercase;color:#15803d}
.supplier .n{font-size:14px;font-weight:700}
.totals{margin-left:auto;display:flex;flex-direction:column;gap:4px;width:320px;max-width:100%}
.totals .row{display:flex;justify-content:space-between;gap:16px}
.totals .strong{border-top:2px solid #000000;padding-top:4px;font-size:13px;font-weight:700}
.signatures{display:grid;gap:32px;margin-top:24px}
.sign{display:flex;flex-direction:column;gap:4px}
.sign .role{font-weight:600}
.sign .line{border-bottom:1px solid #000000;margin-top:32px}
.sign .line.date{margin-top:20px}
.sign .name{min-height:16px;font-size:11px}
.sign .hint{font-size:10px}
.doc-footer{border-top:1px solid rgba(0,0,0,.2);padding-top:8px;font-size:10px}
html.margin-boxes .doc-footer{display:none}
`;

/** Chromium 131+ prints `@page` margin boxes: hide the end-of-document copy of the footer there. */
const MARGIN_BOX_PROBE =
  '<script>(function(){var m=/Chrom(?:e|ium)\\/(\\d+)/.exec(navigator.userAgent);if(m&&Number(m[1])>=131){document.documentElement.className+=" margin-boxes";}})();</script>';

function documentShell(title: string, footer: string, body: string): string {
  const pageCss = `@page{size:A4 portrait;margin:14mm;@bottom-center{content:${cssString(`${footer} · Page `)} counter(page) " of " counter(pages);font-size:8pt;}}`;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${e(title)}</title>`,
    `<style>${pageCss}${BASE_CSS}</style>`,
    MARGIN_BOX_PROBE,
    '</head>',
    '<body>',
    `<article class="doc">${body}<p class="doc-footer">${e(footer)}</p></article>`,
    '</body>',
    '</html>',
  ].join('\n');
}

function header(letterhead: readonly string[], title: string, number: string, chips: readonly string[]): string {
  const lines = letterhead.map((line, index) => `<p class="${index === 0 ? 'l0' : 'ln'}">${e(line)}</p>`).join('');
  const chipHtml = chips.map((chip) => `<span class="chip">${e(chip)}</span>`).join('');
  return `<header class="head"><div class="letterhead">${lines}</div><div class="title"><h1>${e(title)}</h1><p class="number tabular">${e(number)}</p><div class="chips">${chipHtml}</div></div></header>`;
}

function band(text: string, reason?: string | null): string {
  return `<div class="band avoid" role="note"><p class="t">${e(text)}</p>${reason ? `<p class="r">Decline reason: ${e(reason)}</p>` : ''}</div>`;
}

type Entry = { label: string; value: string; full?: boolean };

function details(entries: readonly Entry[]): string {
  const items = entries
    .map((entry) => `<div class="entry${entry.full ? ' full' : ''}"><dt>${e(entry.label)}</dt><dd>${e(entry.value)}</dd></div>`)
    .join('');
  return `<dl class="details avoid">${items}</dl>`;
}

type TotalRow = { label: string; value: string; strong?: boolean };

function totals(rows: readonly TotalRow[]): string {
  const html = rows
    .map((row) => `<div class="row${row.strong ? ' strong' : ''}"><span>${e(row.label)}</span><span class="tabular">${e(row.value)}</span></div>`)
    .join('');
  return `<div class="totals avoid">${html}</div>`;
}

function signatures(entries: readonly { role: string; name: string | null }[]): string {
  const html = entries
    .map(
      (entry) =>
        `<div class="sign"><p class="role">${e(entry.role)}</p><div class="line"></div><p class="name">${e(entry.name ?? '')}</p><p class="hint">Signature over printed name</p><div class="line date"></div><p class="hint">Date</p></div>`,
    )
    .join('');
  return `<div class="signatures avoid" style="grid-template-columns:repeat(${entries.length},minmax(0,1fr))">${html}</div>`;
}

function th(label: string, numeric = false): string {
  return `<th${numeric ? ' class="num"' : ''}>${e(label)}</th>`;
}

function td(value: string, numeric = false): string {
  return `<td${numeric ? ' class="num"' : ''}>${e(value)}</td>`;
}

// ---------------------------------------------------------------------------
// Purchase request (§C)
// ---------------------------------------------------------------------------

/** §C: the complete A4 HTML document of one purchase request. */
export function buildPurchaseRequestHtml(pr: PurchaseRequest, context: PrintDocumentContext): string {
  const estimate = prEstimateTotals(pr.items);
  const approver = commonApprover(pr.items);
  const status = labelOf(PR_STATUS_LABELS, pr.status);

  const rows = pr.items
    .map((item, index) => {
      const amount = itemEstimateCents(item);
      const declined = item.decision === 'declined';
      const reason = declined && item.decision_reason ? item.decision_reason : null;
      const remarks = `${item.remarks !== null ? e(item.remarks) : reason ? '' : e(NO_VALUE)}${reason ? `<span class="reason">Declined: ${e(reason)}</span>` : ''}`;
      return [
        `<tr${declined ? ' class="declined"' : ''}>`,
        `<td class="tabular">${index + 1}</td>`,
        td(item.item.name),
        td(item.supplier.name),
        td(formatQty(item.qty), true),
        td(item.unit),
        td(item.estimated_unit_price_cents === null ? NO_VALUE : formatPeso(item.estimated_unit_price_cents), true),
        td(amount === null ? NO_VALUE : formatPeso(amount), true),
        td(labelOf(DECISION_LABELS, item.decision)),
        `<td>${remarks}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');

  const table = `<table aria-label="Requested items"><thead><tr>${th('#')}${th('Item')}${th('Supplier')}${th('Qty', true)}${th('Unit')}${th('Est. unit price', true)}${th('Est. amount', true)}${th('Decision')}${th('Remarks')}</tr></thead><tbody>${rows}</tbody></table>`;

  const body = [
    header(context.letterhead, 'PURCHASE REQUEST', pr.pr_no, [status]),
    pr.status !== 'approved' ? band(PR_NOT_APPROVED_TEXT) : '',
    details([
      { label: 'Requested by', value: pr.requested_by.name },
      { label: 'Date requested', value: dateTime(pr.created_at, context.timezone) },
      { label: 'Date needed', value: pr.date_needed ? formatPrintBusinessDate(pr.date_needed) : NO_VALUE },
      { label: 'Status', value: status },
      {
        label: 'Purchase order',
        value: pr.purchase_order ? `${pr.purchase_order.po_no} · ${labelOf(PO_STATUS_LABELS, pr.purchase_order.status)}` : NO_VALUE,
      },
      ...(pr.remarks ? [{ label: 'Remarks', value: pr.remarks, full: true }] : []),
    ]),
    table,
    totals([
      { label: 'Estimated total (all items)', value: estimate.totalCents === null ? NO_VALUE : formatPeso(estimate.totalCents) },
      { label: 'Estimated total (approved items)', value: formatPeso(estimate.approvedCents), strong: true },
      ...(estimate.unpricedCount > 0 ? [{ label: 'Items without a price', value: String(estimate.unpricedCount) }] : []),
    ]),
    signatures([
      { role: 'Requested by', name: pr.requested_by.name },
      { role: 'Approved by', name: approver?.name ?? null },
    ]),
  ].join('');

  return documentShell(pr.pr_no, printFooterText(context.printedAt, context.userName, pr.pr_no), body);
}

// ---------------------------------------------------------------------------
// Purchase order (§D)
// ---------------------------------------------------------------------------

export type PurchaseOrderHtmlOptions = {
  /** §D.6: one supplier's copy; `null` / omitted = All suppliers. */
  supplierId?: number | null;
  /** The readable supplier records (contact, number, email, address); a missing one prints the name only. */
  suppliers?: readonly Supplier[];
};

function supplierBlock(group: SupplierGroup, supplier: Supplier | null): string {
  const lines = supplier
    ? [
        supplier.contact_person ? `Attn: ${supplier.contact_person}` : null,
        [supplier.contact_number, supplier.email].filter(Boolean).join(' · ') || null,
        supplier.address,
      ].filter((line): line is string => Boolean(line))
    : [];
  return `<div class="supplier avoid"><p class="k">Supplier</p><p class="n">${e(supplier?.name ?? group.supplier.name)}</p>${lines.map((line) => `<p>${e(line)}</p>`).join('')}</div>`;
}

/** §D: the complete A4 HTML document of one purchase order (all suppliers, or one supplier's copy). */
export function buildPurchaseOrderHtml(po: PurchaseOrder, context: PrintDocumentContext, options: PurchaseOrderHtmlOptions = {}): string {
  const selection = selectSupplierGroups(po, options.supplierId ?? null);
  const records = new Map<number, Supplier>();
  for (const supplier of options.suppliers ?? []) records.set(supplier.id, supplier);
  const withReceived = showReceivedColumns(po);
  const breakGroups = selection.groups.length > 1;
  const createdAt = poDate(po);

  const head = `<tr>${th('#')}${th('Item')}${th('Qty', true)}${th('Unit')}${th('Unit price', true)}${th('Amount', true)}${withReceived ? `${th('Received', true)}${th('Remaining', true)}` : ''}</tr>`;

  const groups = selection.groups
    .map((group, index) => {
      const rows = group.lines
        .map(
          (line, lineIndex) =>
            `<tr><td class="tabular">${lineIndex + 1}</td>${td(line.item.name)}${td(formatQty(line.qty), true)}${td(line.unit)}${td(formatPeso(line.unit_price_cents), true)}${td(formatPeso(line.line_total_cents), true)}${
              withReceived ? `${td(formatQty(line.received_qty), true)}${td(formatQty(line.remaining_qty), true)}` : ''
            }</tr>`,
        )
        .join('');
      const subtotal = selection.only ? '' : totals([{ label: `Subtotal · ${group.supplier.name}`, value: formatPeso(group.subtotalCents) }]);
      return `<section class="group${breakGroups && index > 0 ? ' group-break' : ''}">${supplierBlock(group, records.get(group.supplier.id) ?? null)}<table aria-label="${e(`Lines for ${group.supplier.name}`)}"><thead>${head}</thead><tbody>${rows}</tbody></table>${subtotal}</section>`;
    })
    .join('');

  const body = [
    header(context.letterhead, 'PURCHASE ORDER', po.po_no, [labelOf(PO_STATUS_LABELS, po.status), labelOf(PO_RECEIVING_STATUS_LABELS, po.receiving_status)]),
    po.status !== 'approved' ? band(PO_NOT_APPROVED_TEXT, po.status === 'declined' ? po.decline_reason : null) : '',
    details([
      { label: 'PO date', value: createdAt ? dateTime(createdAt, context.timezone) : NO_VALUE },
      { label: 'From request', value: po.purchase_request.pr_no },
      { label: 'Created by', value: po.created_by?.name ?? NO_VALUE },
      {
        label: 'Approved by',
        value: po.approved_by ? `${po.approved_by.name}${po.approved_at ? ` · ${dateTime(po.approved_at, context.timezone)}` : ''}` : NO_VALUE,
      },
      { label: 'Expected delivery', value: po.expected_delivery_date ? formatPrintBusinessDate(po.expected_delivery_date) : NO_VALUE },
      { label: 'Remarks', value: po.remarks ?? NO_VALUE, full: true },
    ]),
    selection.only ? `<p class="note">Lines for ${e(selection.only.name)} only</p>` : '',
    groups,
    totals([{ label: selection.only ? `Total · ${selection.only.name}` : 'Grand total', value: formatPeso(selection.totalCents), strong: true }]),
    signatures([
      { role: 'Prepared by', name: po.created_by?.name ?? null },
      { role: 'Approved by', name: po.approved_by?.name ?? null },
      { role: 'Received by', name: null },
    ]),
  ].join('');

  return documentShell(po.po_no, printFooterText(context.printedAt, context.userName, po.po_no), body);
}
