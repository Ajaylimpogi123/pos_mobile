/**
 * Products (Catalogue → Admin products, `product.manage`): every non-deleted
 * product, in menu order. Availability tabs (`is_available`), a category
 * filter (`category_id`), a name / SKU search, the table and the cursor
 * "Load more". Price and cost are the server's centavos, formatted at render.
 * A row opens the edit page; Delete confirms in a dialog.
 */
import { EllipsisIcon, PencilIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { StockModeBadge } from '@/components/catalog/StockModeBadge';
import { ProductImage } from '@/components/sell/SellParts';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminProductList, useCategoryOptions, useDeleteProduct } from '@/hooks/useCatalogAdmin';
import { useDebounced } from '@/hooks/useDebounced';
import { getErrorMessage } from '@/services/api';
import type { AdminProduct } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { stockModeOf } from '@pos/core/recipe';

type AvailabilityTab = 'all' | 'available' | 'unavailable';

const AVAILABILITY_FILTER: Record<AvailabilityTab, boolean | null> = { all: null, available: true, unavailable: false };

const column = dataTableColumns<AdminProduct>();

export function ProductsPage() {
  useShellHeader('Products');
  const navigate = useNavigate();
  const [tab, setTab] = useState<AvailabilityTab>('all');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const categories = useCategoryOptions();
  const list = useAdminProductList(search, categoryId, AVAILABILITY_FILTER[tab]);
  const deletion = useDeleteProduct();
  const [toDelete, setToDelete] = useState<AdminProduct | null>(null);

  const columns = useMemo<DataTableColumn<AdminProduct>[]>(
    () => [
      column.display({
        id: 'name',
        header: 'Product',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductImage imageUrl={row.original.image_url} imagePath={row.original.image_path} className="size-10 shrink-0" />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{row.original.name}</span>
              {row.original.sku ? <span className="text-[13px] text-muted-foreground tabular">{row.original.sku}</span> : null}
            </div>
          </div>
        ),
      }),
      column.display({ id: 'category', header: 'Category', cell: ({ row }) => row.original.category.name }),
      column.display({ id: 'price', header: 'Price', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.price_cents) }),
      column.display({
        id: 'cost',
        header: 'Cost',
        meta: { align: 'right' },
        cell: ({ row }) =>
          row.original.cost_cents > 0 ? formatPeso(row.original.cost_cents) : <span className="text-muted-foreground">Not set</span>,
      }),
      column.display({
        id: 'stock',
        header: 'Stock',
        cell: ({ row }) => {
          const mode = stockModeOf(row.original);
          return (
            <div className="flex flex-wrap items-center gap-2">
              <StockModeBadge mode={mode} />
              {mode === 'own' && row.original.stock_qty !== null ? (
                <span className="text-[13px] text-muted-foreground tabular">{row.original.stock_qty} on hand</span>
              ) : null}
            </div>
          );
        },
      }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_available ? <StatusBadge tone="success" label="Available" /> : <StatusBadge tone="danger" label="Unavailable" />,
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
                <DropdownMenuItem onSelect={() => navigate(`/products/${row.original.id}`)}>
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

  const filtered = search !== '' || tab !== 'all' || categoryId !== null;

  return (
    <PageBand
      title="Products"
      actions={
        <Button asChild variant="green" size="lg">
          <Link to="/products/new">
            <PlusIcon aria-hidden="true" />
            Add product
          </Link>
        </Button>
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value as AvailabilityTab)}>
            <TabsList aria-label="Availability">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="available">Available</TabsTrigger>
              <TabsTrigger value="unavailable">Unavailable</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="products-category">Category</Label>
            <NativeSelect
              id="products-category"
              value={categoryId === null ? '' : String(categoryId)}
              onChange={(event) => setCategoryId(event.target.value === '' ? null : Number(event.target.value))}
              disabled={categories.loading}
            >
              <option value="">{categories.error ? 'All categories (list unavailable)' : 'All categories'}</option>
              {categories.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {category.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </NativeSelect>
          </div>
          <SearchField id="products-search" label="Search products" value={term} onChange={setTerm} placeholder="Name or SKU" />
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading products…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the products" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching products" message="Try another name, SKU, category or availability." />
          ) : (
            <EmptyState
              title="No products yet"
              message="Add the items you sell, with their price and category."
              action={
                <Button asChild variant="green" size="lg">
                  <Link to="/products/new">Add product</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <DataTable
              label="Products"
              columns={columns}
              data={list.items}
              getRowId={(product) => String(product.id)}
              onRowClick={(product) => navigate(`/products/${product.id}`)}
              rowLabel={(product) => `${product.name}, ${formatPeso(product.price_cents)}`}
            />
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="products"
            />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete product"
        description={toDelete ? `${toDelete.name} is removed from the menu. Past sales keep their own copy of it.` : ''}
        confirmLabel="Delete product"
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
