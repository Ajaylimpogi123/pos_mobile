/**
 * Order History (back-office.md list page; Core Sale → GET /orders): the band
 * with the title, the branch and business date, and the business-day picker as
 * its action; then the table card with the status tabs, the **Needs review**
 * filter (`order.review`; Offline Sales → Review), the invoice search, the table
 * and the cursor "Load more". A row (click or Enter) opens the detail: a right
 * sheet at ≥ 1280 px, a full page below (MASTER §6). The row ⋯ menu opens the
 * same detail with View, Reprint receipt, Refund or Void sale already started.
 *
 * `/orders/review` (the sidebar's Needs review entry) is this page with the
 * filter on and every business day shown (flagged sales may be from any day).
 */
import { BanIcon, CalendarIcon, ClipboardCheckIcon, EllipsisIcon, EyeIcon, PrinterIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { NeedsReviewBadge, OrderStatusBadge } from '@/components/orders/OrderStatus';
import { OrderDetailSheet, type OrderDetailIntent } from '@/components/orders/OrderDetailSheet';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDetailMode } from '@/hooks/useMediaQuery';
import { useOrderList } from '@/hooks/useOrders';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import type { OrderStatus, OrderSummary } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';
import { businessDateAt, formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { ORDER_STATUS_FILTERS, ORDER_STATUS_LABELS } from '@pos/core/sale/reversals';

const STATUS_TABS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...ORDER_STATUS_FILTERS.map((value) => ({ value, label: ORDER_STATUS_LABELS[value] })),
];

const SEARCH_MAX = 30;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const column = dataTableColumns<OrderSummary>();

export function OrdersPage({ needsReview = false }: { needsReview?: boolean }) {
  const title = needsReview ? 'Needs review' : 'Order History';
  useShellHeader(title);
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const canReview = hasPermission(user, PERMISSIONS.orderReview);
  const timezone = user?.branch.timezone ?? 'Asia/Manila';
  const [today] = useState(() => (user ? businessDateAt(Date.now(), user.branch.timezone, user.branch.day_start_time) : ''));

  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [businessDate, setBusinessDate] = useState<string>(needsReview ? '' : today);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);
  const [selected, setSelected] = useState<{ ulid: string; intent: OrderDetailIntent } | null>(null);
  const detailMode = useDetailMode();
  // The same rules as the detail's reversal gate (which also checks the shift and decides).
  const canVoid = hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleVoid]);
  const canRefund = hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleRefund]);

  const list = useOrderList({ businessDate: businessDate || null, search, status: status === 'all' ? null : status, needsReview });

  const columns = useMemo<DataTableColumn<OrderSummary>[]>(
    () => [
      column.display({
        id: 'invoice',
        header: 'Invoice',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.invoice_no}</span>
            <span className="text-[13px] text-muted-foreground tabular">
              #{row.original.queue_no}
              {row.original.table_no ? ` · Table ${row.original.table_no}` : ''}
            </span>
          </div>
        ),
      }),
      column.display({
        id: 'placed',
        header: 'Placed',
        cell: ({ row }) => <span className="whitespace-nowrap">{formatBranchDateTime(row.original.placed_at, timezone) ?? row.original.placed_at}</span>,
      }),
      column.display({ id: 'cashier', header: 'Cashier', cell: ({ row }) => row.original.cashier.name }),
      column.display({
        id: 'customer',
        header: 'Customer',
        cell: ({ row }) => row.original.customer?.full_name ?? <span className="text-muted-foreground">Walk-in</span>,
      }),
      column.display({
        id: 'items',
        header: 'Items',
        meta: { align: 'right' },
        cell: ({ row }) => row.original.items_count,
      }),
      column.display({
        id: 'payment',
        header: 'Payment',
        cell: ({ row }) => row.original.payment_methods.map(paymentMethodLabel).join(' + '),
      }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <OrderStatusBadge status={row.original.status} />
            {row.original.needs_review ? <NeedsReviewBadge /> : null}
          </div>
        ),
      }),
      column.display({
        id: 'total',
        header: 'Total',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span className="font-semibold">
            {formatPeso(row.original.total_cents)}
            {row.original.refunded_cents > 0 ? (
              <span className="block text-[13px] font-normal text-info">-{formatPeso(row.original.refunded_cents)} refunded</span>
            ) : null}
          </span>
        ),
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => {
          const order = row.original;
          const open = (intent: OrderDetailIntent) => setSelected({ ulid: order.ulid, intent });
          const voidable = canVoid && order.status === 'completed';
          const refundable = canRefund && (order.status === 'completed' || order.status === 'partially_refunded');
          return (
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${order.invoice_no}`}>
                    <EllipsisIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => open('view')}>
                    <EyeIcon aria-hidden="true" />
                    View
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => open('reprint')}>
                    <PrinterIcon aria-hidden="true" />
                    Reprint receipt
                  </DropdownMenuItem>
                  {refundable ? (
                    <DropdownMenuItem onSelect={() => open('refund')}>
                      <Undo2Icon aria-hidden="true" />
                      Refund
                    </DropdownMenuItem>
                  ) : null}
                  {voidable ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => open('void')}>
                        <BanIcon aria-hidden="true" />
                        Void sale
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [timezone, canVoid, canRefund],
  );

  const note = needsReview ? 'Flagged offline sales' : null;
  const showPage = detailMode === 'page' && selected !== null;

  // back-office.md §1: the date picker is a band action (white, outline style).
  const dateActions = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Business day">
      <div className="relative">
        <CalendarIcon className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          id="orders-date"
          type="date"
          aria-label="Business day"
          value={businessDate}
          max={today || undefined}
          onChange={(event) => setBusinessDate(event.target.value)}
          className="h-9 w-48 pl-9"
        />
      </div>
      {businessDate ? (
        <Button variant="outline" onClick={() => setBusinessDate('')}>
          All days
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setBusinessDate(today)}>
          Today
        </Button>
      )}
    </div>
  );

  return (
    <>
      <div hidden={showPage}>
        <PageBand title={title} businessDate={today} note={note} actions={dateActions}>
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Tabs value={status} onValueChange={(value) => setStatus(value as OrderStatus | 'all')}>
                  <TabsList aria-label="Order status">
                    {STATUS_TABS.map((tab) => (
                      <TabsTrigger key={tab.value} value={tab.value}>
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {canReview ? (
                  <Button
                    variant="outline"
                    aria-pressed={needsReview}
                    className={cn(needsReview && 'border-warning-border bg-warning-bg text-warning hover:bg-warning-bg')}
                    onClick={() => navigate(needsReview ? '/orders' : '/orders/review')}
                  >
                    <ClipboardCheckIcon aria-hidden="true" />
                    Needs review
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <SearchField
                  id="orders-search"
                  label="Invoice number"
                  value={term}
                  maxLength={SEARCH_MAX}
                  onChange={setTerm}
                  placeholder="e.g. 00000042"
                  className="min-w-56"
                />
              </div>
            </div>

            {list.loading ? (
              <LoadingRows rows={6} label="Loading orders…" />
            ) : list.error ? (
              <ErrorState title="Couldn't load the orders" message={list.error} onRetry={list.retry} />
            ) : list.items.length === 0 ? (
              <EmptyState
                title="No orders found"
                message={
                  needsReview && !search && status === 'all' && !businessDate
                    ? 'No offline sale needs review. Flagged sales appear here after a terminal syncs them.'
                    : search || status !== 'all' || needsReview
                    ? 'No order matches these filters. Clear the search or pick another status.'
                    : businessDate
                      ? 'No sales on this business day yet. Pick another day, or show all days.'
                      : 'Sales appear here once they are rung up.'
                }
              />
            ) : (
              <>
                <DataTable
                  label="Orders"
                  columns={columns}
                  data={list.items}
                  getRowId={(order) => order.ulid}
                  onRowClick={(order) => setSelected({ ulid: order.ulid, intent: 'view' })}
                  rowLabel={(order) => `${order.invoice_no}, ${formatPeso(order.total_cents)}`}
                />
                <LoadMoreFooter
                  shown={list.items.length}
                  hasMore={list.hasMore}
                  loading={list.loadingMore}
                  onLoadMore={list.loadMore}
                  error={list.loadMoreError}
                  noun="orders"
                />
              </>
            )}
          </Card>
          {detailMode === 'sheet' ? (
            <OrderDetailSheet mode="sheet" ulid={selected?.ulid ?? null} intent={selected?.intent} onClose={() => setSelected(null)} />
          ) : null}
        </PageBand>
      </div>
      {showPage ? (
        <OrderDetailSheet mode="page" ulid={selected.ulid} intent={selected.intent} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
