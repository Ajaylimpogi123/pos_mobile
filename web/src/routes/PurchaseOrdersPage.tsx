/**
 * Purchasing → Purchase orders (§G, §L) and → Receiving (§H, `to_receive`:
 * approved and not fully received). Orders: the status tabs
 * (`?status=pending_approval` opens Pending Approval), the receiving filter,
 * a search, the table and the cursor "Load more"; a row opens the detail.
 * Receiving: the orders to receive; a row opens the receive page.
 */
import { EyeIcon, PrinterIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { ToneBadge } from '@/components/common/ToneBadge';
import { PurchasingNav } from '@/components/purchasing/PurchasingNav';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RowActions } from '@/components/common/RowActions';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { PO_RECEIVING_STATUS, PO_STATUS, statusFor } from '@/constants/purchasingLabels';
import { PO_RECEIVING_STATUSES, PO_STATUSES, usePurchaseOrderList } from '@/hooks/purchasing/usePurchaseOrders';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useDebounced } from '@/hooks/useDebounced';
import type { PurchaseOrder, PurchaseOrderReceivingStatus, PurchaseOrderStatus } from '@/services/types';
import { formatPeso } from '@pos/core/money';

const column = dataTableColumns<PurchaseOrder>();

function suppliersText(po: PurchaseOrder): string {
  const names = [...new Set(po.lines.map((line) => line.supplier.name))];
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export function PurchaseOrdersPage({ mode }: { mode: 'orders' | 'receiving' }) {
  const receiving = mode === 'receiving';
  useShellHeader(receiving ? 'Receiving' : 'Purchase orders');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { canReceive } = usePurchasingPermissions();
  const initial = params.get('status');
  const [status, setStatus] = useState<PurchaseOrderStatus | 'all'>(
    !receiving && PO_STATUSES.includes(initial as PurchaseOrderStatus) ? (initial as PurchaseOrderStatus) : 'all',
  );
  const [receivingStatus, setReceivingStatus] = useState<PurchaseOrderReceivingStatus | 'all'>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = usePurchaseOrderList(mode, search, status, receivingStatus);

  const openOrder = useCallback(
    (po: PurchaseOrder) => navigate(receiving && canReceive ? `/purchasing/receiving/${po.ulid}` : `/purchasing/orders/${po.ulid}`),
    [navigate, receiving, canReceive],
  );

  const columns = useMemo<DataTableColumn<PurchaseOrder>[]>(
    () => [
      column.display({
        id: 'no',
        header: 'Order',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium tabular">{row.original.po_no}</span>
            <span className="text-[13px] text-muted-foreground tabular">From {row.original.purchase_request.pr_no}</span>
          </div>
        ),
      }),
      column.display({
        id: 'suppliers',
        header: 'Suppliers',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{suppliersText(row.original)}</span>
            <span className="text-[13px] text-muted-foreground">
              {row.original.lines.length} {row.original.lines.length === 1 ? 'line' : 'lines'}
            </span>
          </div>
        ),
      }),
      column.display({
        id: 'delivery',
        header: 'Expected',
        cell: ({ row }) => <span className="tabular">{row.original.expected_delivery_date ?? '—'}</span>,
      }),
      column.display({ id: 'total', header: 'Total', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.total_cents) }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <ToneBadge info={statusFor(PO_STATUS, row.original.status)} />
            {row.original.status === 'approved' ? <ToneBadge info={statusFor(PO_RECEIVING_STATUS, row.original.receiving_status)} /> : null}
          </div>
        ),
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', className: 'w-12', srLabel: 'Actions' },
        cell: ({ row }) => (
          <RowActions label={`Actions for ${row.original.po_no}`}>
            <DropdownMenuItem onSelect={() => openOrder(row.original)}>
              <EyeIcon aria-hidden="true" />
              {receiving && canReceive ? 'Receive' : 'View'}
            </DropdownMenuItem>
            {/* Purchase Request & Order PDF (v1.24 §A): the print view in a new tab. */}
            <DropdownMenuItem asChild>
              <Link to={`/purchasing/orders/${row.original.ulid}/print`} target="_blank" rel="noopener">
                <PrinterIcon aria-hidden="true" />
                Print {row.original.po_no}
              </Link>
            </DropdownMenuItem>
          </RowActions>
        ),
      }),
    ],
    [openOrder, receiving, canReceive],
  );

  const filtered = search !== '' || status !== 'all' || receivingStatus !== 'all';

  return (
    <PageBand
      title={receiving ? 'Receiving' : 'Purchase orders'}
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <PurchasingNav />
          <div className="flex flex-wrap items-end gap-3">
            {!receiving ? (
              <>
                <Tabs value={status} onValueChange={(value) => setStatus(value as PurchaseOrderStatus | 'all')}>
                  <TabsList aria-label="Status">
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="pending_approval">{PO_STATUS.pending_approval.label}</TabsTrigger>
                    <TabsTrigger value="approved">Approved</TabsTrigger>
                    <TabsTrigger value="declined">{PO_STATUS.declined.label}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex w-full flex-col gap-1.5 sm:w-56">
                  <Label htmlFor="po-receiving">Receiving</Label>
                  <NativeSelect
                    id="po-receiving"
                    value={receivingStatus}
                    onChange={(event) => setReceivingStatus(event.target.value as PurchaseOrderReceivingStatus | 'all')}
                  >
                    <option value="all">Any receiving status</option>
                    {PO_RECEIVING_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {PO_RECEIVING_STATUS[value].label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </>
            ) : null}
            <SearchField id="po-search" label="Search orders" value={term} onChange={setTerm} placeholder="PO number or item" />
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading purchase orders…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the purchase orders" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching orders" message="Try another number, item or status." />
          ) : receiving ? (
            <EmptyState title="Nothing to receive" message="Approved orders that aren't fully received show here." />
          ) : (
            <EmptyState title="No purchase orders yet" message="A purchase order is created when request items are approved." />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <DataTable
                label={receiving ? 'Orders to receive' : 'Purchase orders'}
                columns={columns}
                data={list.items}
                getRowId={(po) => po.ulid}
                onRowClick={openOrder}
                rowLabel={(po) => `${po.po_no}, ${statusFor(PO_STATUS, po.status).label}, ${formatPeso(po.total_cents)}`}
              />
            </div>
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
    </PageBand>
  );
}
