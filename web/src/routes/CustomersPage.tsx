/**
 * Customers (Staff & Customers → Customer endpoints): every customer, by first
 * then last name. A search (names, email, and phone-like terms on the contact),
 * the table and the cursor "Load more". Add and edit need `sale.create`;
 * Delete (confirmed) needs `customer.manage`. A row opens the edit page.
 */
import { EllipsisIcon, PencilIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CUSTOMER_LIMITS, useCustomerList, useDeleteCustomer } from '@/hooks/useCustomers';
import { useDebounced } from '@/hooks/useDebounced';
import { getErrorMessage } from '@/services/api';
import type { Customer } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

const column = dataTableColumns<Customer>();

export function CustomersPage() {
  useShellHeader('Customers');
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const canEdit = hasPermission(user, PERMISSIONS.saleCreate);
  const canDelete = hasPermission(user, PERMISSIONS.customerManage);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useCustomerList(search);
  const deletion = useDeleteCustomer();
  const [toDelete, setToDelete] = useState<Customer | null>(null);

  const columns = useMemo<DataTableColumn<Customer>[]>(
    () => [
      column.display({ id: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.full_name}</span> }),
      column.display({
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (row.original.contact ? <span className="tabular">{row.original.contact}</span> : <span className="text-muted-foreground">—</span>),
      }),
      column.display({
        id: 'email',
        header: 'Email',
        cell: ({ row }) => row.original.email ?? <span className="text-muted-foreground">—</span>,
      }),
      column.display({
        id: 'notes',
        header: 'Notes',
        meta: { className: 'max-w-[280px]' },
        cell: ({ row }) =>
          row.original.notes ? <span className="line-clamp-1 text-muted-foreground">{row.original.notes}</span> : <span className="text-muted-foreground">—</span>,
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) =>
          canEdit || canDelete ? (
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.full_name}`}>
                    <EllipsisIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit ? (
                    <DropdownMenuItem onSelect={() => navigate(`/customers/${row.original.id}`)}>
                      <PencilIcon aria-hidden="true" />
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <>
                      {canEdit ? <DropdownMenuSeparator /> : null}
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
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      }),
    ],
    [canDelete, canEdit, deletion, navigate],
  );

  return (
    <PageBand
      title="Customers"
      actions={
        canEdit ? (
          <Button asChild variant="green" size="lg">
            <Link to="/customers/new">
              <PlusIcon aria-hidden="true" />
              Add customer
            </Link>
          </Button>
        ) : null
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <SearchField
            id="customers-search"
            label="Search customers"
            value={term}
            onChange={setTerm}
            placeholder="Name, email or phone number"
            maxLength={CUSTOMER_LIMITS.search}
          />
        </div>
        {list.loading ? (
          <LoadingRows rows={5} label="Loading customers…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the customers" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          search ? (
            <EmptyState title="No matching customers" message="Try part of the name, the email, or the phone number's digits." />
          ) : (
            <EmptyState title="No customers yet" message="Customers added here or at the counter appear in this list." />
          )
        ) : (
          <>
            <DataTable
              label="Customers"
              columns={columns}
              data={list.items}
              getRowId={(customer) => String(customer.id)}
              onRowClick={canEdit ? (customer) => navigate(`/customers/${customer.id}`) : undefined}
              rowLabel={(customer) => customer.full_name}
            />
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="customers"
            />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete customer"
        description={toDelete ? `${toDelete.full_name} is removed from the customer list. Past sales keep their name.` : ''}
        confirmLabel="Delete customer"
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
