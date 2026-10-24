/**
 * Printers (Printing → Admin printers; `settings.manage`): the branch's
 * printers with their role, address, paper and routes; **Test print** through
 * the queue; "Receipts from this terminal" for cashier printers; edit and
 * delete (confirmed). Warns when the branch has no default kitchen printer.
 */
import { EllipsisIcon, PencilIcon, PlusIcon, PrinterIcon, ReceiptTextIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Banner } from '@/components/common/Banner';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { PrintersNav } from '@/components/printers/PrintersNav';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTestPrinting } from '@/hooks/useOrderPrinting';
import { usePrintConfig, useReceiptPrinter } from '@/hooks/usePrintConfig';
import { useDeletePrinter, usePrinterList, useRoutableCategories } from '@/hooks/usePrinters';
import { printerRoleLabel } from '@pos/core/printing/documents/format';
import { getErrorMessage } from '@/services/api';
import type { Printer } from '@/services/types';

const column = dataTableColumns<Printer>();

export function PrintersPage() {
  useShellHeader('Printers & settings');
  const navigate = useNavigate();
  const list = usePrinterList();
  const categories = useRoutableCategories();
  const { config } = usePrintConfig();
  const receiptPrinter = useReceiptPrinter(config);
  const testing = useTestPrinting();
  const deletion = useDeletePrinter();
  const [toDelete, setToDelete] = useState<Printer | null>(null);

  const categoryNames = useMemo(() => new Map(categories.categories.map((category) => [category.id, category.name])), [categories.categories]);
  const hasTicketPrinter = list.items.some((printer) => printer.role !== 'cashier');
  const hasDefaultKitchen = list.items.some((printer) => printer.is_default_kitchen);
  const currentReceiptId = receiptPrinter.current?.id ?? null;

  const columns = useMemo<DataTableColumn<Printer>[]>(
    () => [
      column.display({
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{row.original.name}</span>
            <div className="flex flex-wrap gap-1">
              {row.original.is_default_kitchen ? (
                <Badge tone="outline">
                  Default kitchen
                </Badge>
              ) : null}
              {row.original.id === currentReceiptId ? (
                <Badge tone="neutral">
                  Receipts from this terminal
                </Badge>
              ) : null}
            </div>
          </div>
        ),
      }),
      column.display({ id: 'role', header: 'Role', cell: ({ row }) => printerRoleLabel(row.original.role) }),
      column.display({
        id: 'address',
        header: 'Address',
        cell: ({ row }) => <span className="tabular">{`${row.original.host}:${row.original.port}`}</span>,
      }),
      column.display({ id: 'paper', header: 'Paper', cell: ({ row }) => `${row.original.paper_width_mm} mm` }),
      column.display({
        id: 'routes',
        header: 'Categories',
        cell: ({ row }) =>
          row.original.role === 'cashier' ? (
            <span className="text-muted-foreground">Receipts</span>
          ) : row.original.category_ids.length === 0 ? (
            <span className="text-muted-foreground">{row.original.is_default_kitchen ? 'Unrouted items' : 'None'}</span>
          ) : (
            row.original.category_ids.map((id) => categoryNames.get(id) ?? `Category ${id}`).join(', ')
          ),
      }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_enabled ? <StatusBadge tone="success" label="Enabled" /> : <StatusBadge tone="danger" label="Disabled" />,
      }),
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
                <DropdownMenuItem onSelect={() => navigate(`/printers/${row.original.id}`)}>
                  <PencilIcon aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!row.original.is_enabled} onSelect={() => void testing.printTest(row.original.id)}>
                  <PrinterIcon aria-hidden="true" />
                  Test print
                </DropdownMenuItem>
                {row.original.role === 'cashier' && row.original.is_enabled ? (
                  <DropdownMenuItem onSelect={() => receiptPrinter.choose(row.original.id)}>
                    <ReceiptTextIcon aria-hidden="true" />
                    Use for receipts on this terminal
                  </DropdownMenuItem>
                ) : null}
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
    [categoryNames, currentReceiptId, navigate, receiptPrinter, testing],
  );

  return (
    <PageBand
      title="Printers & settings"
      actions={
        <Button asChild variant="green" size="lg">
          <Link to="/printers/new">
            <PlusIcon aria-hidden="true" />
            Add printer
          </Link>
        </Button>
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <PrintersNav />
          {!list.loading && hasTicketPrinter && !hasDefaultKitchen ? (
            <Banner variant="warning">
              No default kitchen printer: items from categories with no route are not sent to any printer.
            </Banner>
          ) : null}
        </div>
        {list.loading ? (
          <LoadingRows rows={4} label="Loading printers…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the printers" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title="No printers yet"
            message="Add the receipt printer at the counter and the kitchen or bar printers, with their network address."
            action={
              <Button asChild variant="green" size="lg">
                <Link to="/printers/new">Add printer</Link>
              </Button>
            }
          />
        ) : (
          <>
            <DataTable
              label="Printers"
              columns={columns}
              data={list.items}
              getRowId={(printer) => String(printer.id)}
              onRowClick={(printer) => navigate(`/printers/${printer.id}`)}
              rowLabel={(printer) => `${printer.name}, ${printerRoleLabel(printer.role)}`}
            />
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="printers"
            />
          </>
        )}
        {testing.tracker.jobs.length > 0 || testing.notice ? (
          <div className="border-t border-border p-4">
            <PrintJobList tracker={testing.tracker} notices={testing.notice ? [testing.notice] : []} title="Test prints" />
          </div>
        ) : null}
      </Card>

      <Dialog open={toDelete !== null} onOpenChange={(open) => (open ? null : setToDelete(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete printer</DialogTitle>
            <DialogDescription>
              {toDelete ? `${toDelete.name} stops receiving jobs. Its category routes and default flag are removed.` : ''}
            </DialogDescription>
          </DialogHeader>
          {deletion.error ? <Banner>{getErrorMessage(deletion.error)}</Banner> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={deletion.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructiveSolid"
              disabled={deletion.isPending}
              onClick={() => {
                if (!toDelete) return;
                deletion.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
              }}
            >
              {deletion.isPending ? 'Deleting…' : 'Delete printer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBand>
  );
}
