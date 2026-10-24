/**
 * Inventory → Ingredient detail (§D, §D1, §L; Q-026): the stock panel (on
 * hand, status, reorder level, average cost, stock value; **Adjust stock**,
 * **Count**, **Wastage**, **Set cost**), and the history (newest first, type
 * filter incl. **Cost set**, "Load more"), with the entered quantity and unit,
 * the value moved, and the order or purchase-order reference.
 */
import { ArrowLeftIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { IngredientStockPanel } from '@/components/inventory/IngredientStockPanel';
import { IngredientMovementRow } from '@/components/inventory/MovementRows';
import { OrderDetailSheet } from '@/components/orders/OrderDetailSheet';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { INGREDIENT_MOVEMENT_TYPES } from '@/constants/inventoryLabels';
import { useIngredientMovements, useIngredientStockItem } from '@/hooks/useIngredientStock';
import { useDetailMode } from '@/hooks/useMediaQuery';
import { useInventoryPermissions } from '@/hooks/useInventory';
import type { BaseUnit, IngredientMovementType } from '@/services/types';
import { useSessionStore } from '@/stores/session';

export function IngredientStockDetailPage() {
  const params = useParams();
  const parsed = Number(params.id);
  const id = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  const detail = useIngredientStockItem(id);
  const permissions = useInventoryPermissions();
  useShellHeader(detail.item ? detail.item.name : 'Ingredient stock');
  // MASTER §6: an order opened from the history is a right sheet at ≥ 1280 px and a full page below.
  const [order, setOrder] = useState<string | null>(null);
  const detailMode = useDetailMode();
  const showPage = detailMode === 'page' && order !== null;

  return (
    <>
      <div hidden={showPage}>
        <PlainPage
          title={detail.item?.name ?? 'Ingredient stock'}
          subtitle={detail.item ? `Counted in ${detail.item.base_unit}${detail.item.is_active ? '' : ' · inactive'}` : null}
          actions={
            <>
              {detail.item && permissions.canManageProducts ? (
                <Button asChild variant="outline">
                  <Link to={`/ingredients/${detail.item.id}`}>
                    <PencilIcon aria-hidden="true" />
                    Edit ingredient
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link to="/inventory/ingredients">
                  <ArrowLeftIcon aria-hidden="true" />
                  Inventory
                </Link>
              </Button>
            </>
          }
        >
          <div className="flex w-full max-w-[960px] flex-col gap-4">
            {detail.loading ? (
              <Card>
                <LoadingRows rows={3} label="Loading the stock…" />
              </Card>
            ) : detail.item ? (
              <IngredientStockPanel item={detail.item} canAdjust={permissions.canAdjust} />
            ) : (
              <Card>
                <ErrorState title="Couldn't load the stock" message={detail.error ?? 'Not found.'} onRetry={detail.reload} />
              </Card>
            )}
            {id !== null && detail.item ? <HistoryCard id={id} baseUnit={detail.item.base_unit} onOpenOrder={permissions.canOpenOrders ? setOrder : undefined} /> : null}
          </div>
        </PlainPage>
      </div>
      {permissions.canOpenOrders ? <OrderDetailSheet mode={detailMode} ulid={order} onClose={() => setOrder(null)} backLabel="Back to the stock" /> : null}
    </>
  );
}

function HistoryCard({ id, baseUnit, onOpenOrder }: { id: number; baseUnit: BaseUnit; onOpenOrder?: (ulid: string) => void }) {
  const [type, setType] = useState<IngredientMovementType | null>(null);
  const { canReadPurchasing } = useInventoryPermissions();
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const history = useIngredientMovements(id, type);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
        <h2 className="text-base font-semibold">History</h2>
        <div className="flex w-full flex-col gap-1.5 sm:w-48">
          <Label htmlFor="ingredient-movement-type">Type</Label>
          <NativeSelect
            id="ingredient-movement-type"
            value={type ?? ''}
            onChange={(event) => setType(event.target.value === '' ? null : (event.target.value as IngredientMovementType))}
          >
            <option value="">All types</option>
            {INGREDIENT_MOVEMENT_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {history.loading ? (
        <LoadingRows rows={4} label="Loading the history…" />
      ) : history.error ? (
        <ErrorState title="Couldn't load the history" message={history.error} onRetry={history.retry} />
      ) : history.items.length === 0 ? (
        <EmptyState title={type ? 'No movements of this type' : 'No movements yet'} message="Receipts, sales, counts, wastage and cost changes show here." />
      ) : (
        <>
          <ul aria-label="Stock movements">
            {history.items.map((movement) => (
              <IngredientMovementRow
                key={movement.ulid}
                movement={movement}
                baseUnit={baseUnit}
                timeZone={timezone}
                onOpenOrder={onOpenOrder}
                canOpenPurchaseOrder={canReadPurchasing}
              />
            ))}
          </ul>
          <LoadMoreFooter
            shown={history.items.length}
            hasMore={history.hasMore}
            loading={history.loadingMore}
            onLoadMore={history.loadMore}
            error={history.loadMoreError}
            noun="movements"
          />
        </>
      )}
    </Card>
  );
}
