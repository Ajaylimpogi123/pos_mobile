/**
 * Inventory → Products (Inventory (v1 completion); `inventory.adjust` or
 * `report.view`): every tracked product of the branch, by name. The status
 * tabs `All · Low (3) · Out (1)` come from the branch-wide `meta.summary`
 * (`?status=alerts` opens **Low & out**), plus a category filter and a name /
 * SKU search, the table and the cursor "Load more". A row opens the detail.
 */
import { EyeIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { ToneBadge } from '@/components/common/ToneBadge';
import { InventoryKindSwitch } from '@/components/inventory/InventoryKindSwitch';
import { ProductImage } from '@/components/sell/SellParts';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RowActions } from '@/components/common/RowActions';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { reorderText, STOCK_STATUS } from '@/constants/inventoryLabels';
import { useDebounced } from '@/hooks/useDebounced';
import { useInventoryCategories, useInventoryList, type InventorySegment } from '@/hooks/useInventory';
import { cn } from '@/lib/utils';
import type { InventoryItem } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatQty } from '@pos/core/quantity';

const column = dataTableColumns<InventoryItem>();

export function InventoryPage() {
  useShellHeader('Inventory');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromAlerts = params.get('status') === 'alerts';
  const [segment, setSegment] = useState<InventorySegment>(fromAlerts ? 'alerts' : 'all');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const categories = useInventoryCategories();
  const { list, summary } = useInventoryList(search, categoryId, segment);

  const columns = useMemo<DataTableColumn<InventoryItem>[]>(
    () => [
      column.display({
        id: 'name',
        header: 'Product',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductImage imageUrl={row.original.image_url} imagePath={null} className="size-10 shrink-0" />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{row.original.name}</span>
              <span className="text-[13px] text-muted-foreground tabular">
                {row.original.sku ? `${row.original.sku} · ` : ''}
                {reorderText(row.original.reorder_level)}
              </span>
            </div>
          </div>
        ),
      }),
      column.display({ id: 'category', header: 'Category', cell: ({ row }) => row.original.category.name }),
      column.display({
        id: 'qty',
        header: 'On hand',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span className={cn('text-base font-bold', row.original.qty <= 0 && 'text-danger')}>{formatQty(row.original.qty)}</span>
        ),
      }),
      column.display({ id: 'cost', header: 'Cost', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.cost_cents) }),
      column.display({ id: 'value', header: 'Stock value', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.stock_value_cents) }),
      column.display({ id: 'status', header: 'Status', cell: ({ row }) => <ToneBadge info={STOCK_STATUS[row.original.status]} /> }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => (
          <RowActions label={`Actions for ${row.original.name}`}>
            <DropdownMenuItem onSelect={() => navigate(`/inventory/${row.original.product_id}`)}>
              <EyeIcon aria-hidden="true" />
              Stock and history
            </DropdownMenuItem>
          </RowActions>
        ),
      }),
    ],
    [navigate],
  );

  const filtered = search !== '' || segment !== 'all' || categoryId !== null;
  const subtitle = summary ? `${formatQty(summary.tracked)} tracked ${summary.tracked === 1 ? 'product' : 'products'}` : null;

  return (
    <PageBand title="Inventory" note={subtitle}>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <InventoryKindSwitch />
          <div className="flex flex-wrap items-end gap-3">
            <Tabs value={segment} onValueChange={(value) => setSegment(value as InventorySegment)}>
              <TabsList aria-label="Stock status">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="low">Low{summary ? ` (${formatQty(summary.low)})` : ''}</TabsTrigger>
                <TabsTrigger value="out">Out{summary ? ` (${formatQty(summary.out)})` : ''}</TabsTrigger>
                {fromAlerts || segment === 'alerts' ? <TabsTrigger value="alerts">Low &amp; out</TabsTrigger> : null}
              </TabsList>
            </Tabs>
            <div className="flex w-full flex-col gap-1.5 sm:w-56">
              <Label htmlFor="inventory-category">Category</Label>
              <NativeSelect
                id="inventory-category"
                value={categoryId === null ? '' : String(categoryId)}
                onChange={(event) => setCategoryId(event.target.value === '' ? null : Number(event.target.value))}
                disabled={categories.loading}
              >
                <option value="">{categories.error ? 'All categories (list unavailable)' : 'All categories'}</option>
                {categories.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <SearchField id="inventory-search" label="Search products" value={term} onChange={setTerm} placeholder="Name or SKU" />
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading inventory…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the inventory" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching products" message="Try another name, SKU, category or status." />
          ) : (
            <EmptyState title="No tracked products yet" message="Set a product's stock mode to Own stock on the Products page to track it here." />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <DataTable
                label="Inventory"
                columns={columns}
                data={list.items}
                getRowId={(item) => String(item.product_id)}
                onRowClick={(item) => navigate(`/inventory/${item.product_id}`)}
                rowLabel={(item) => `${item.name}, ${formatQty(item.qty)} on hand, ${STOCK_STATUS[item.status].label}`}
              />
            </div>
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
    </PageBand>
  );
}
