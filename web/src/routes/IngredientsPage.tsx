/**
 * Ingredients (§D; Q-025): every non-deleted ingredient, by name, with the
 * active tabs (`is_active`), a name search, the table and the cursor "Load
 * more". Managing (add, edit, delete) needs `product.manage`; the list is also
 * readable with `inventory.adjust`, any purchase permission or `report.view`.
 * A row opens the edit page (or, for readers of inventory, the stock detail).
 */
import { EllipsisIcon, PencilIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { INGREDIENTS_NAV } from '@/components/catalog/ingredientsNav';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { SubNav } from '@/components/common/SubNav';
import { ToneBadge } from '@/components/common/ToneBadge';
import { ProductImage } from '@/components/sell/SellParts';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { averageCostText, STOCK_STATUS } from '@/constants/inventoryLabels';
import { useDebounced } from '@/hooks/useDebounced';
import { useDeleteIngredient, useIngredientList } from '@/hooks/useIngredients';
import { useInventoryPermissions } from '@/hooks/useInventory';
import { getErrorMessage } from '@/services/api';
import type { Ingredient } from '@/services/types';
import { formatQty } from '@pos/core/quantity';

type ActiveTab = 'all' | 'active' | 'inactive';
const ACTIVE_FILTER: Record<ActiveTab, boolean | null> = { all: null, active: true, inactive: false };

const column = dataTableColumns<Ingredient>();

export function IngredientsPage() {
  useShellHeader('Ingredients');
  const navigate = useNavigate();
  const permissions = useInventoryPermissions();
  const canManage = permissions.canManageProducts;
  const [tab, setTab] = useState<ActiveTab>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useIngredientList(search, ACTIVE_FILTER[tab]);
  const deletion = useDeleteIngredient();
  const [toDelete, setToDelete] = useState<Ingredient | null>(null);

  const openRow = canManage
    ? (item: Ingredient) => navigate(`/ingredients/${item.id}`)
    : permissions.canRead
      ? (item: Ingredient) => navigate(`/inventory/ingredients/${item.id}`)
      : undefined;

  const columns = useMemo<DataTableColumn<Ingredient>[]>(() => {
    const base: DataTableColumn<Ingredient>[] = [
      column.display({
        id: 'name',
        header: 'Ingredient',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductImage imageUrl={row.original.image_url} imagePath={row.original.image_path} className="size-10 shrink-0" />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{row.original.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {row.original.units.length === 0 ? 'No own units' : row.original.units.map((unit) => unit.name).join(', ')}
              </span>
            </div>
          </div>
        ),
      }),
      column.display({ id: 'base', header: 'Base unit', cell: ({ row }) => row.original.base_unit }),
      column.display({
        id: 'qty',
        header: 'On hand',
        meta: { align: 'right' },
        cell: ({ row }) => `${formatQty(row.original.qty)} ${row.original.base_unit}`,
      }),
      column.display({ id: 'cost', header: 'Avg cost', meta: { align: 'right' }, cell: ({ row }) => averageCostText(row.original) }),
      column.display({ id: 'stock', header: 'Stock', cell: ({ row }) => <ToneBadge info={STOCK_STATUS[row.original.status]} /> }),
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
                <DropdownMenuItem onSelect={() => navigate(`/ingredients/${row.original.id}`)}>
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
    ];
  }, [canManage, deletion, navigate]);

  const filtered = search !== '' || tab !== 'all';

  return (
    <PageBand
      title="Ingredients"
      actions={
        canManage ? (
          <Button asChild variant="green" size="lg">
            <Link to="/ingredients/new">
              <PlusIcon aria-hidden="true" />
              Add ingredient
            </Link>
          </Button>
        ) : null
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <SubNav label="Ingredients and units" links={INGREDIENTS_NAV} />
          <div className="flex flex-wrap items-end gap-3">
            <Tabs value={tab} onValueChange={(value) => setTab(value as ActiveTab)}>
              <TabsList aria-label="Status">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="inactive">Inactive</TabsTrigger>
              </TabsList>
            </Tabs>
            <SearchField id="ingredients-search" label="Search ingredients" value={term} onChange={setTerm} placeholder="Name" />
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={6} label="Loading ingredients…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the ingredients" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching ingredients" message="Try another name or status." />
          ) : (
            <EmptyState
              title="No ingredients yet"
              message="Add the ingredients your recipes use, e.g. flour in grams or eggs in pieces."
              action={
                canManage ? (
                  <Button asChild variant="green" size="lg">
                    <Link to="/ingredients/new">Add ingredient</Link>
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <DataTable
                label="Ingredients"
                columns={columns}
                data={list.items}
                getRowId={(item) => String(item.id)}
                onRowClick={openRow}
                rowLabel={(item) => `${item.name}, ${formatQty(item.qty)} ${item.base_unit} on hand`}
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

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete ingredient"
        description={toDelete ? `${toDelete.name} is removed. Past stock movements and purchases keep their records.` : ''}
        confirmLabel="Delete ingredient"
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
