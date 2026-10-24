/**
 * Categories (Catalogue: Categories & Products → Admin categories,
 * `product.manage`): every non-deleted category, inactive ones included, in
 * menu order (`sort_order`, then name). Status tabs (`is_active`), a name
 * search, the table and the cursor "Load more". A row opens the edit page;
 * Delete confirms in a dialog, and the server's 409 ("This category still has
 * products…") shows there.
 */
import { EllipsisIcon, PencilIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { ProductImage } from '@/components/sell/SellParts';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminCategoryList, useDeleteCategory } from '@/hooks/useCatalogAdmin';
import { useDebounced } from '@/hooks/useDebounced';
import { getErrorMessage } from '@/services/api';
import type { Category } from '@/services/types';

type StatusTab = 'all' | 'active' | 'inactive';

const STATUS_FILTER: Record<StatusTab, boolean | null> = { all: null, active: true, inactive: false };

const column = dataTableColumns<Category>();

export function CategoriesPage() {
  useShellHeader('Categories');
  const navigate = useNavigate();
  const [tab, setTab] = useState<StatusTab>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useAdminCategoryList(search, STATUS_FILTER[tab]);
  const deletion = useDeleteCategory();
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const columns = useMemo<DataTableColumn<Category>[]>(
    () => [
      column.display({
        id: 'name',
        header: 'Category',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductImage imageUrl={row.original.image_url} imagePath={row.original.image_path} className="size-10 shrink-0" />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{row.original.name}</span>
              {row.original.description ? (
                <span className="line-clamp-1 text-[13px] text-muted-foreground">{row.original.description}</span>
              ) : null}
            </div>
          </div>
        ),
      }),
      column.display({ id: 'products', header: 'Products', meta: { align: 'right' }, cell: ({ row }) => row.original.products_count }),
      column.display({ id: 'sort', header: 'Sort order', meta: { align: 'right' }, cell: ({ row }) => row.original.sort_order }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_active ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="warning" label="Hidden from POS" />,
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
                <DropdownMenuItem onSelect={() => navigate(`/categories/${row.original.id}`)}>
                  <PencilIcon aria-hidden="true" />
                  Edit
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
    ],
    [deletion, navigate],
  );

  const filtered = search !== '' || tab !== 'all';

  return (
    <PageBand
      title="Categories"
      actions={
        <Button asChild variant="green" size="lg">
          <Link to="/categories/new">
            <PlusIcon aria-hidden="true" />
            Add category
          </Link>
        </Button>
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value as StatusTab)}>
            <TabsList aria-label="Status">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="inactive">Inactive</TabsTrigger>
            </TabsList>
          </Tabs>
          <SearchField id="categories-search" label="Search categories" value={term} onChange={setTerm} placeholder="Category name" />
        </div>
        {list.loading ? (
          <LoadingRows rows={5} label="Loading categories…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the categories" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching categories" message="Try another name or status." />
          ) : (
            <EmptyState
              title="No categories yet"
              message="Add the sections of your menu, e.g. Breakfast, Meals and Drinks."
              action={
                <Button asChild variant="green" size="lg">
                  <Link to="/categories/new">Add category</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <DataTable
              label="Categories"
              columns={columns}
              data={list.items}
              getRowId={(category) => String(category.id)}
              onRowClick={(category) => navigate(`/categories/${category.id}`)}
              rowLabel={(category) => `${category.name}, ${category.products_count} products`}
            />
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="categories"
            />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete category"
        description={toDelete ? `${toDelete.name} is removed from the menu. A category that still has products can't be deleted.` : ''}
        confirmLabel="Delete category"
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
