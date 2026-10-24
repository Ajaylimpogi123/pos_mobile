/**
 * Suppliers (§C): every non-deleted supplier, with the active tabs
 * (`is_active`), a name or contact search, the table and the cursor "Load
 * more". Managing needs `supplier.manage` (add, edit, deactivate or
 * reactivate, delete; a supplier on a PR or PO can't be deleted: the 409
 * "Deactivate it instead." shows in the dialog). Any purchase permission reads.
 */
import { EllipsisIcon, PencilIcon, PlusIcon, PowerIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { ToneBadge } from '@/components/common/ToneBadge';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useDebounced } from '@/hooks/useDebounced';
import { useDeleteSupplier, useSetSupplierActive, useSupplierList } from '@/hooks/useSuppliers';
import { getErrorMessage } from '@/services/api';
import type { Supplier } from '@/services/types';

type ActiveTab = 'all' | 'active' | 'inactive';
const ACTIVE_FILTER: Record<ActiveTab, boolean | null> = { all: null, active: true, inactive: false };

const column = dataTableColumns<Supplier>();

export function SuppliersPage() {
  useShellHeader('Suppliers');
  const navigate = useNavigate();
  const { canManageSuppliers: canManage } = usePurchasingPermissions();
  const [tab, setTab] = useState<ActiveTab>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useSupplierList(search, ACTIVE_FILTER[tab]);
  const deletion = useDeleteSupplier();
  const activation = useSetSupplierActive();
  const [toDelete, setToDelete] = useState<Supplier | null>(null);
  const [toToggle, setToToggle] = useState<Supplier | null>(null);

  const columns = useMemo<DataTableColumn<Supplier>[]>(() => {
    const base: DataTableColumn<Supplier>[] = [
      column.display({ id: 'name', header: 'Supplier', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> }),
      column.display({
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{row.original.contact_person ?? <span className="text-muted-foreground">—</span>}</span>
            {row.original.contact_number ? <span className="text-[13px] text-muted-foreground tabular">{row.original.contact_number}</span> : null}
          </div>
        ),
      }),
      column.display({ id: 'email', header: 'Email', cell: ({ row }) => row.original.email ?? <span className="text-muted-foreground">—</span> }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (row.original.is_active ? <StatusBadge tone="success" label="Active" /> : <ToneBadge info={{ label: 'Inactive', tone: 'neutral' }} />),
      }),
    ];
    if (!canManage) return base;
    return [
      ...base,
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.name}`}>
                  <EllipsisIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate(`/suppliers/${row.original.id}`)}>
                  <PencilIcon aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    activation.reset();
                    setToToggle(row.original);
                  }}
                >
                  <PowerIcon aria-hidden="true" />
                  {row.original.is_active ? 'Deactivate' : 'Reactivate'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    deletion.reset();
                    setToDelete(row.original);
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ];
  }, [canManage, deletion, activation, navigate]);

  const filtered = search !== '' || tab !== 'all';

  return (
    <PageBand
      title="Suppliers"
      actions={
        canManage ? (
          <Button asChild variant="green" size="lg">
            <Link to="/suppliers/new">
              <PlusIcon aria-hidden="true" />
              Add supplier
            </Link>
          </Button>
        ) : null
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value as ActiveTab)}>
            <TabsList aria-label="Status">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="inactive">Inactive</TabsTrigger>
            </TabsList>
          </Tabs>
          <SearchField id="suppliers-search" label="Search suppliers" value={term} onChange={setTerm} placeholder="Name or contact" />
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading suppliers…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the suppliers" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching suppliers" message="Try another name, contact or status." />
          ) : (
            <EmptyState
              title="No suppliers yet"
              message="Add the suppliers you buy from; purchase requests pick them per item."
              action={
                canManage ? (
                  <Button asChild variant="green" size="lg">
                    <Link to="/suppliers/new">Add supplier</Link>
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <DataTable
                label="Suppliers"
                columns={columns}
                data={list.items}
                getRowId={(supplier) => String(supplier.id)}
                onRowClick={canManage ? (supplier) => navigate(`/suppliers/${supplier.id}`) : undefined}
                rowLabel={(supplier) => `${supplier.name}${supplier.is_active ? '' : ', inactive'}`}
              />
            </div>
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="suppliers"
            />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={toToggle !== null}
        onClose={() => setToToggle(null)}
        title={toToggle?.is_active ? 'Deactivate supplier' : 'Reactivate supplier'}
        description={
          toToggle?.is_active
            ? `${toToggle.name} can't be picked on new purchase requests. Existing requests and orders keep it.`
            : `${toToggle?.name ?? ''} can be picked on purchase requests again.`
        }
        confirmLabel={toToggle?.is_active ? 'Deactivate' : 'Reactivate'}
        pendingLabel="Saving…"
        pending={activation.isPending}
        error={activation.error ? getErrorMessage(activation.error) : null}
        destructive={toToggle?.is_active ?? false}
        onConfirm={() => {
          if (toToggle) activation.mutate({ id: toToggle.id, isActive: !toToggle.is_active }, { onSuccess: () => setToToggle(null) });
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete supplier"
        description={toDelete ? `${toDelete.name} is removed. A supplier on a purchase request or order can only be deactivated.` : ''}
        confirmLabel="Delete supplier"
        pendingLabel="Deleting…"
        pending={deletion.isPending}
        error={deletion.error ? getErrorMessage(deletion.error) : null}
        onConfirm={() => {
          if (toDelete) deletion.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
        }}
      />
    </PageBand>
  );
}
