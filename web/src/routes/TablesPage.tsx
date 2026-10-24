/**
 * Admin → Tables (Dine-in Tables & Tabs §B/§I; `settings.manage`): the
 * branch's dining tables grouped by area, with add, edit, activate or
 * deactivate and delete (confirmed). It works while dine-in is off, so tables
 * can be set up first (the sidebar item shows only while it is on; Settings
 * links here). A table with an open bill can't be deactivated or deleted
 * (`409`, shown in the dialog).
 */
import { EllipsisIcon, PencilIcon, PlusIcon, PowerIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { Banner } from '@/components/common/Banner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { TableFormDialog } from '@/components/tables/TableFormDialog';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAdminTableList, useDeleteTable, useDineIn, useSetTableActive } from '@/hooks/useDiningTables';
import { getErrorMessage } from '@/services/api';
import type { DiningTable } from '@/services/types';
import { groupByArea, NO_AREA_LABEL } from '@/utils/tables';

const column = dataTableColumns<DiningTable>();

export function TablesPage() {
  useShellHeader('Tables');
  const list = useAdminTableList();
  const dineIn = useDineIn();
  const deletion = useDeleteTable();
  const activation = useSetTableActive();
  /** `undefined`: closed; `null`: a new table. */
  const [editing, setEditing] = useState<DiningTable | null | undefined>(undefined);
  const [newArea, setNewArea] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DiningTable | null>(null);
  const [toToggle, setToToggle] = useState<DiningTable | null>(null);

  const groups = useMemo(() => groupByArea(list.items), [list.items]);

  function add(area: string | null) {
    setNewArea(area);
    setEditing(null);
  }

  const columns = useMemo<DataTableColumn<DiningTable>[]>(
    () => [
      column.display({ id: 'name', header: 'Table', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> }),
      column.display({ id: 'seats', header: 'Seats', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular">{row.original.seats}</span> }),
      column.display({ id: 'sort', header: 'Sort order', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular">{row.original.sort_order}</span> }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_active ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="danger" label="Inactive" />,
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for table ${row.original.name}`}>
                  <EllipsisIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                  <PencilIcon aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setToToggle(row.original)}>
                  <PowerIcon aria-hidden="true" />
                  {row.original.is_active ? 'Deactivate' : 'Activate'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(row.original)}>
                  <TrashIcon aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    [],
  );

  return (
    <PageBand
      title="Tables"
      actions={
        <Button variant="green" size="lg" onClick={() => add(null)}>
          <PlusIcon aria-hidden="true" />
          Add table
        </Button>
      }
    >
      {!dineIn.loading && !dineIn.enabled ? (
        <Banner variant="info">
          Dine-in is off, so these tables don't show on the POS yet. Turn it on in{' '}
          <Link to="/printers/receipt-settings" className="font-semibold underline underline-offset-4">
            Receipt settings
          </Link>
          .
        </Banner>
      ) : null}

      {list.loading ? (
        <Card>
          <LoadingRows rows={5} label="Loading tables…" />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Couldn't load the tables" message={list.error} onRetry={list.retry} />
        </Card>
      ) : list.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No tables yet"
            message="Add each dining table with its seats. Use an area (Patio, Upstairs) to group them."
            action={
              <Button variant="green" size="lg" onClick={() => add(null)}>
                Add table
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {groups.map((group) => (
            <Card key={group.key} className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                <h2 className="text-base font-semibold">
                  {group.area ?? NO_AREA_LABEL}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {group.tables.length} {group.tables.length === 1 ? 'table' : 'tables'}
                  </span>
                </h2>
                <Button variant="outline" size="sm" onClick={() => add(group.area)}>
                  <PlusIcon aria-hidden="true" />
                  Add here
                </Button>
              </div>
              <DataTable
                label={`Tables in ${group.area ?? NO_AREA_LABEL}`}
                columns={columns}
                data={group.tables}
                getRowId={(table) => String(table.id)}
                onRowClick={(table) => setEditing(table)}
                rowLabel={(table) => `Table ${table.name}, ${table.seats} seats`}
              />
            </Card>
          ))}
          <Card>
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="tables"
            />
          </Card>
        </>
      )}

      <TableFormDialog
        table={editing}
        defaultArea={newArea}
        onClose={() => {
          setEditing(undefined);
          setNewArea(null);
        }}
      />

      <ConfirmDialog
        open={toToggle !== null}
        onClose={() => {
          setToToggle(null);
          activation.reset();
        }}
        title={toToggle?.is_active ? `Deactivate table ${toToggle.name}` : `Activate table ${toToggle?.name ?? ''}`}
        description={
          toToggle?.is_active ? 'It no longer shows on the POS Tables view. Its past orders are kept.' : 'It shows on the POS Tables view again.'
        }
        confirmLabel={toToggle?.is_active ? 'Deactivate' : 'Activate'}
        pendingLabel="Saving…"
        pending={activation.isPending}
        error={activation.error ? getErrorMessage(activation.error) : null}
        destructive={toToggle?.is_active ?? false}
        onConfirm={() => {
          if (!toToggle) return;
          activation.mutate(
            { id: toToggle.id, active: !toToggle.is_active },
            {
              onSuccess: (saved) => {
                toast.success(saved.is_active ? `Table ${saved.name} is active.` : `Table ${saved.name} is inactive.`);
                setToToggle(null);
              },
            },
          );
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => {
          setToDelete(null);
          deletion.reset();
        }}
        title={`Delete table ${toDelete?.name ?? ''}`}
        description="It is removed from the POS. Orders already paid at this table keep its name."
        confirmLabel="Delete table"
        pendingLabel="Deleting…"
        pending={deletion.isPending}
        error={deletion.error ? getErrorMessage(deletion.error) : null}
        onConfirm={() => {
          if (!toDelete) return;
          deletion.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success(`Table ${toDelete.name} deleted.`);
              setToDelete(null);
            },
          });
        }}
      />
    </PageBand>
  );
}
