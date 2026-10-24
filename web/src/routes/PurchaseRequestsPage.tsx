/**
 * Purchasing → Purchase requests (§F, §L): newest first, with the views
 * `All · Needs my decision · Mine` (`needs_decision` for approvers;
 * `?view=decision` opens it), the status filter, a search (PR number or item
 * name), the table and the cursor "Load more". **New request** needs
 * `purchase.request`. A row opens the detail.
 */
import { EyeIcon, PlusIcon, PrinterIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { ToneBadge } from '@/components/common/ToneBadge';
import { PurchasingNav } from '@/components/purchasing/PurchasingNav';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RowActions } from '@/components/common/RowActions';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { PO_STATUS, PR_STATUS, statusFor } from '@/constants/purchasingLabels';
import { usePurchaseRequestList, type PurchaseRequestView } from '@/hooks/purchasing/usePurchaseRequests';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useDebounced } from '@/hooks/useDebounced';
import type { PurchaseRequest, PurchaseRequestStatus } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';

const STATUSES = Object.keys(PR_STATUS) as PurchaseRequestStatus[];
const column = dataTableColumns<PurchaseRequest>();

function itemsText(pr: PurchaseRequest): string {
  const names = pr.items.map((item) => item.item.name);
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export function PurchaseRequestsPage() {
  useShellHeader('Purchase requests');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { canApprove, canRequest } = usePurchasingPermissions();
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const [view, setView] = useState<PurchaseRequestView>(params.get('view') === 'decision' && canApprove ? 'decision' : 'all');
  const [status, setStatus] = useState<PurchaseRequestStatus | 'all'>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = usePurchaseRequestList(search, status, view);

  const columns = useMemo<DataTableColumn<PurchaseRequest>[]>(
    () => [
      column.display({
        id: 'no',
        header: 'Request',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium tabular">{row.original.pr_no}</span>
            <span className="text-[13px] text-muted-foreground">{formatBranchDateTime(row.original.created_at, timezone) ?? row.original.created_at}</span>
          </div>
        ),
      }),
      column.display({
        id: 'items',
        header: 'Items',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{itemsText(row.original)}</span>
            <span className="text-[13px] text-muted-foreground">
              {row.original.items.length} {row.original.items.length === 1 ? 'item' : 'items'}
            </span>
          </div>
        ),
      }),
      column.display({ id: 'by', header: 'Requested by', cell: ({ row }) => row.original.requested_by.name }),
      column.display({
        id: 'needed',
        header: 'Date needed',
        cell: ({ row }) => <span className="tabular">{row.original.date_needed ?? '—'}</span>,
      }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <ToneBadge info={statusFor(PR_STATUS, row.original.status)} />
            {row.original.purchase_order ? (
              <span className="text-[13px] text-muted-foreground">
                {row.original.purchase_order.po_no} · {statusFor(PO_STATUS, row.original.purchase_order.status).label}
              </span>
            ) : null}
          </div>
        ),
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', className: 'w-12', srLabel: 'Actions' },
        cell: ({ row }) => (
          <RowActions label={`Actions for ${row.original.pr_no}`}>
            <DropdownMenuItem onSelect={() => navigate(`/purchasing/requests/${row.original.ulid}`)}>
              <EyeIcon aria-hidden="true" />
              View
            </DropdownMenuItem>
            {/* Purchase Request & Order PDF (v1.24 §A): the print view in a new tab. */}
            <DropdownMenuItem asChild>
              <Link to={`/purchasing/requests/${row.original.ulid}/print`} target="_blank" rel="noopener">
                <PrinterIcon aria-hidden="true" />
                Print {row.original.pr_no}
              </Link>
            </DropdownMenuItem>
          </RowActions>
        ),
      }),
    ],
    [timezone, navigate],
  );

  const filtered = search !== '' || status !== 'all' || view !== 'all';

  return (
    <PageBand
      title="Purchase requests"
      actions={
        canRequest ? (
          <Button asChild variant="green" size="lg">
            <Link to="/purchasing/requests/new">
              <PlusIcon aria-hidden="true" />
              New request
            </Link>
          </Button>
        ) : null
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <PurchasingNav />
          <div className="flex flex-wrap items-end gap-3">
            <Tabs value={view} onValueChange={(value) => setView(value as PurchaseRequestView)}>
              <TabsList aria-label="View">
                <TabsTrigger value="all">All</TabsTrigger>
                {canApprove ? <TabsTrigger value="decision">Needs my decision</TabsTrigger> : null}
                <TabsTrigger value="mine">Mine</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex w-full flex-col gap-1.5 sm:w-56">
              <Label htmlFor="pr-status">Status</Label>
              <NativeSelect id="pr-status" value={status} onChange={(event) => setStatus(event.target.value as PurchaseRequestStatus | 'all')}>
                <option value="all">All statuses</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PR_STATUS[value].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <SearchField id="pr-search" label="Search requests" value={term} onChange={setTerm} placeholder="PR number or item" />
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading purchase requests…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the purchase requests" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState
              title={view === 'decision' ? 'Nothing waiting for your decision' : 'No matching requests'}
              message={view === 'decision' ? 'Requests with items to approve or decline show here.' : 'Try another number, item, status or view.'}
            />
          ) : (
            <EmptyState
              title="No purchase requests yet"
              message="Request the ingredients the branch needs; an approver decides each item."
              action={
                canRequest ? (
                  <Button asChild variant="green" size="lg">
                    <Link to="/purchasing/requests/new">New request</Link>
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <DataTable
                label="Purchase requests"
                columns={columns}
                data={list.items}
                getRowId={(pr) => pr.ulid}
                onRowClick={(pr) => navigate(`/purchasing/requests/${pr.ulid}`)}
                rowLabel={(pr) => `${pr.pr_no}, ${statusFor(PR_STATUS, pr.status).label}`}
              />
            </div>
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="requests"
            />
          </>
        )}
      </Card>
    </PageBand>
  );
}
