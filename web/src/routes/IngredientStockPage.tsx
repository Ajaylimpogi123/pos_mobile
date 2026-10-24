/**
 * Inventory → Ingredients (§D ingredient inventory, Q-026; `inventory.adjust`
 * or `report.view`): every ingredient's branch stock, by name, with the
 * `All · Low · Out` tabs from `meta.summary` (`?status=alerts` opens
 * **Low & out**), a name search and the cursor "Load more". On hand shows in
 * the base unit (and a friendlier unit), the average cost per kg / L / pc.
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RowActions } from '@/components/common/RowActions';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { averageCostText, ingredientReorderText, STOCK_STATUS } from '@/constants/inventoryLabels';
import { useDebounced } from '@/hooks/useDebounced';
import { useIngredientStockList } from '@/hooks/useIngredientStock';
import type { InventorySegment } from '@/hooks/useInventory';
import { cn } from '@/lib/utils';
import type { Ingredient } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatQty, friendlyQty, isQtyAtOrBelowZero } from '@pos/core/quantity';

const column = dataTableColumns<Ingredient>();

export function IngredientStockPage() {
  useShellHeader('Inventory');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromAlerts = params.get('status') === 'alerts';
  const [segment, setSegment] = useState<InventorySegment>(fromAlerts ? 'alerts' : 'all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const { list, summary } = useIngredientStockList(search, segment);

  const columns = useMemo<DataTableColumn<Ingredient>[]>(
    () => [
      column.display({
        id: 'name',
        header: 'Ingredient',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductImage imageUrl={row.original.image_url} imagePath={row.original.image_path} className="size-10 shrink-0" />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">
                {row.original.name}
                {row.original.is_active ? '' : ' (inactive)'}
              </span>
              <span className="text-[13px] text-muted-foreground tabular">{ingredientReorderText(row.original)}</span>
            </div>
          </div>
        ),
      }),
      column.display({
        id: 'qty',
        header: 'On hand',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const friendly = friendlyQty(row.original.qty, row.original.base_unit);
          return (
            <div className="flex flex-col items-end">
              <span className={cn('font-bold', isQtyAtOrBelowZero(row.original.qty) && 'text-danger')}>
                {formatQty(row.original.qty)} {row.original.base_unit}
              </span>
              {friendly ? <span className="text-[13px] text-muted-foreground">{friendly}</span> : null}
            </div>
          );
        },
      }),
      column.display({ id: 'cost', header: 'Avg cost', meta: { align: 'right' }, cell: ({ row }) => averageCostText(row.original) }),
      column.display({ id: 'value', header: 'Stock value', meta: { align: 'right' }, cell: ({ row }) => formatPeso(row.original.stock_value_cents) }),
      column.display({ id: 'status', header: 'Status', cell: ({ row }) => <ToneBadge info={STOCK_STATUS[row.original.status]} /> }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => (
          <RowActions label={`Actions for ${row.original.name}`}>
            <DropdownMenuItem onSelect={() => navigate(`/inventory/ingredients/${row.original.id}`)}>
              <EyeIcon aria-hidden="true" />
              Stock and history
            </DropdownMenuItem>
          </RowActions>
        ),
      }),
    ],
    [navigate],
  );

  const filtered = search !== '' || segment !== 'all';
  const subtitle = summary ? `${formatQty(summary.tracked)} tracked ${summary.tracked === 1 ? 'ingredient' : 'ingredients'}` : null;

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
            <SearchField id="ingredient-stock-search" label="Search ingredients" value={term} onChange={setTerm} placeholder="Name" />
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading ingredient stock…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the ingredient stock" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching ingredients" message="Try another name or status." />
          ) : (
            <EmptyState title="No ingredients yet" message="Add ingredients on the Ingredients page; their stock shows here." />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <DataTable
                label="Ingredient stock"
                columns={columns}
                data={list.items}
                getRowId={(item) => String(item.id)}
                onRowClick={(item) => navigate(`/inventory/ingredients/${item.id}`)}
                rowLabel={(item) => `${item.name}, ${formatQty(item.qty)} ${item.base_unit} on hand, ${STOCK_STATUS[item.status].label}`}
              />
            </div>
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="ingredients"
            />
          </>
        )}
      </Card>
    </PageBand>
  );
}
