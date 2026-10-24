/**
 * Purchase Request & Order PDF, revision 2 (v1.27 §G): `@pos/core/purchasing/printHtml`,
 * the A4 HTML the tablet prints (same sections and wording as the web, §B–§D).
 */
import { makePoLine, makePrItem, makePurchaseOrder, makePurchaseRequest, makeSupplier } from '@/test-utils/purchasing';
import type { PrintConfig } from '@/services/types';
import {
  buildPrintContext,
  buildPurchaseOrderHtml,
  buildPurchaseRequestHtml,
  escapeHtml,
  formatPrintBusinessDate,
  PO_NOT_APPROVED_TEXT,
  PR_NOT_APPROVED_TEXT,
  printFileName,
  type PrintDocumentContext,
} from '@pos/core/purchasing/printHtml';

const context: PrintDocumentContext = {
  letterhead: ["Mama Bing's", '12 Lacson St'],
  timezone: 'Asia/Manila',
  printedAt: '12 Oct 2026, 3:04 PM',
  userName: 'Ana',
};

const bakery = { id: 7, name: 'Bakery Supply Co' };

describe('the shared page (§B)', () => {
  const html = buildPurchaseRequestHtml(makePurchaseRequest(), context);

  it('is a complete A4 document with the footer in the margin box and at the end', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('@page{size:A4 portrait;margin:14mm;@bottom-center{content:"Printed 12 Oct 2026, 3:04 PM by Ana · PR-MAIN-2026-00001 · Page " counter(page) " of " counter(pages)');
    expect(html).toContain('<p class="doc-footer">Printed 12 Oct 2026, 3:04 PM by Ana · PR-MAIN-2026-00001</p>');
    expect(html).toContain('thead{display:table-header-group}');
    expect(html).toContain('tr,.avoid{break-inside:avoid;page-break-inside:avoid}');
  });

  it('has no external resources', () => {
    expect(html).not.toMatch(/<link|<img|@import|url\(|src=/);
  });

  it('prints the letterhead', () => {
    expect(html).toContain('<p class="l0">Mama Bing&#39;s</p><p class="ln">12 Lacson St</p>');
  });
});

describe('purchase request (§C)', () => {
  it('has the title, details, columns, totals, signatures and the band', () => {
    const pr = makePurchaseRequest({
      items: [
        makePrItem({ decision: 'declined', decision_reason: 'Enough stock', decided_by: { id: 2, name: 'Mia' } }),
        makePrItem({ id: 32, estimated_unit_price_cents: null, remarks: 'Any brand' }),
      ],
    });
    const html = buildPurchaseRequestHtml(pr, context);
    expect(html).toContain('<h1>PURCHASE REQUEST</h1>');
    expect(html).toContain('<span class="chip">Pending Approval</span>');
    expect(html).toContain(PR_NOT_APPROVED_TEXT);
    for (const label of ['Requested by', 'Date requested', 'Date needed', 'Status', 'Purchase order', 'Remarks']) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('<dd>Thu, 1 Oct 2026</dd>');
    for (const column of ['#', 'Item', 'Supplier', 'Qty', 'Unit', 'Est. unit price', 'Est. amount', 'Decision', 'Remarks']) expect(html).toMatch(new RegExp(`<th[^>]*>${column.replace('.', '\\.')}</th>`));
    expect(html).toContain('<tr class="declined">');
    expect(html).toContain('<span class="reason">Declined: Enough stock</span>');
    expect(html).toContain('Estimated total (all items)');
    expect(html).toContain('Estimated total (approved items)');
    expect(html).toContain('<span>Items without a price</span><span class="tabular">1</span>');
    expect(html).toContain('<p class="role">Requested by</p>');
    expect(html).toContain('<p class="role">Approved by</p><div class="line"></div><p class="name">Mia</p>');
  });

  it('drops the band once approved', () => {
    expect(buildPurchaseRequestHtml(makePurchaseRequest({ status: 'approved' }), context)).not.toContain(PR_NOT_APPROVED_TEXT);
  });

  it('escapes every value', () => {
    const html = buildPurchaseRequestHtml(
      makePurchaseRequest({ remarks: '<script>alert("x")</script>', items: [makePrItem({ item: { type: 'ingredient', id: 1, name: 'Salt & "Pepper"' } })] }),
      { ...context, userName: 'A"</style>' },
    );
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Salt &amp; &quot;Pepper&quot;');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('A"</style>');
  });
});

describe('purchase order (§D)', () => {
  const po = makePurchaseOrder({
    total_cents: 290000,
    lines: [makePoLine({ id: 1 }), makePoLine({ id: 2, item: { type: 'ingredient', id: 8, name: 'Yeast' }, supplier: bakery, line_total_cents: 50000 })],
  });

  it('groups lines per supplier with details, subtotals, the grand total and signatures', () => {
    const html = buildPurchaseOrderHtml(po, context, { suppliers: [makeSupplier()] });
    expect(html).toContain('<h1>PURCHASE ORDER</h1>');
    expect(html).toContain('<span class="chip">Pending Approval</span><span class="chip">Not Received</span>');
    expect(html).toContain(PO_NOT_APPROVED_TEXT);
    for (const label of ['PO date', 'From request', 'Created by', 'Approved by', 'Expected delivery', 'Remarks']) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('<p class="n">Golden Mills Trading</p><p>Attn: Ana Reyes</p><p>0917 123 4567 · orders@goldenmills.test</p><p>12 Rizal St, Bacolod</p>');
    expect(html).toContain('<p class="n">Bakery Supply Co</p></div>');
    expect(html).toContain('Subtotal · Golden Mills Trading');
    expect(html).toContain('Subtotal · Bakery Supply Co');
    expect(html).toContain('<span>Grand total</span>');
    expect(html).toContain('<section class="group group-break">');
    for (const role of ['Prepared by', 'Approved by', 'Received by']) expect(html).toContain(`<p class="role">${role}</p>`);
  });

  it('leaves Received / Remaining out while nothing was received', () => {
    const html = buildPurchaseOrderHtml(po, context);
    expect(html).not.toContain('>Received</th>');
    expect(html).not.toContain('>Remaining</th>');
    const received = buildPurchaseOrderHtml({ ...po, status: 'approved', receiving_status: 'partially_received' }, context);
    expect(received).toContain('<th class="num">Received</th><th class="num">Remaining</th>');
    expect(received).not.toContain(PO_NOT_APPROVED_TEXT);
  });

  it('prints one supplier’s copy', () => {
    const html = buildPurchaseOrderHtml(po, context, { supplierId: 7 });
    expect(html).toContain('<p class="note">Lines for Bakery Supply Co only</p>');
    expect(html).not.toContain('Golden Mills Trading</p>');
    expect(html).not.toContain('Subtotal ·');
    expect(html).toContain('<span>Total · Bakery Supply Co</span>');
    expect(html).not.toContain('group-break"');
  });

  it('shows the decline reason on a declined PO', () => {
    const html = buildPurchaseOrderHtml({ ...po, status: 'declined', decline_reason: 'Too pricey' }, context);
    expect(html).toContain('<p class="r">Decline reason: Too pricey</p>');
  });
});

describe('helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('names the file after the document number', () => {
    expect(printFileName('PR-MAIN-2026-00003')).toBe('PR-MAIN-2026-00003.pdf');
    expect(printFileName('a/b')).toBe('a-b.pdf');
  });

  it('formats business dates', () => {
    expect(formatPrintBusinessDate('2026-09-24')).toBe('Thu, 24 Sep 2026');
    expect(formatPrintBusinessDate('bad')).toBe('bad');
  });

  it('builds the context from print-config, or falls back to the branch name', () => {
    const config = { branch: { name: 'Main', timezone: 'Asia/Manila' }, settings: { receipt_header_lines: [' Mama Bing ', ''] } } as unknown as PrintConfig;
    const now = Date.parse('2026-10-12T07:04:00Z');
    expect(buildPrintContext({ config, fallbackBranchName: 'X', fallbackTimezone: 'UTC', userName: 'Ana', now })).toEqual({
      letterhead: ['Mama Bing'],
      timezone: 'Asia/Manila',
      printedAt: '12 Oct 2026, 3:04 PM',
      userName: 'Ana',
    });
    expect(buildPrintContext({ config: null, fallbackBranchName: 'Main', fallbackTimezone: 'Asia/Manila', userName: '', now }).letterhead).toEqual(['Main']);
  });
});

describe('snapshots', () => {
  it('matches the purchase request document', () => {
    expect(buildPurchaseRequestHtml(makePurchaseRequest(), context)).toMatchSnapshot();
  });

  it('matches the purchase order document (two suppliers, partially received)', () => {
    const po = makePurchaseOrder({
      status: 'approved',
      receiving_status: 'partially_received',
      approved_by: { id: 1, name: 'Owen Owner' },
      approved_at: '2026-09-28T03:00:00Z',
      total_cents: 290000,
      lines: [makePoLine({ id: 1, received_qty: '1.000', remaining_qty: '1.000' }), makePoLine({ id: 2, supplier: bakery, line_total_cents: 50000 })],
    });
    expect(buildPurchaseOrderHtml(po, context, { suppliers: [makeSupplier()] })).toMatchSnapshot();
  });
});
