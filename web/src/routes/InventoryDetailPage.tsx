/**
 * Inventory → Product detail (Inventory (v1 completion) → Device rules):
 * - the summary: on hand, status, reorder level with **Edit**, cost and stock value;
 * - the actions (`inventory.adjust`): **Stock in**, **Count**, **Wastage**
 *   and **Adjust stock**, each a dialog on the idempotent adjustment flow;
 * - the history (newest first, type filter, "Load more"): a sale, void or
 *   refund shows its order label, which opens the order.
 * A product that no longer tracks stock (409) still shows its history.
 */
import { ArrowDownToLine, ArrowLeftIcon, ArrowUpDown, ClipboardList, PencilIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { Banner } from '@/components/common/Banner';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { ToneBadge } from '@/components/common/ToneBadge';
import { ProductMovementRow } from '@/components/inventory/MovementRows';
import { ProductReorderDialog, ProductStockDialog } from '@/components/inventory/ProductStockDialogs';
import { OrderDetailSheet } from '@/components/orders/OrderDetailSheet';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { MOVEMENT_TYPES, reorderText, STOCK_STATUS } from '@/constants/inventoryLabels';
import {
  useInventoryItem,
  useInventoryMovements,
  useInventoryPermissions,
  useReorderLevelDialog,
  useStockDialog,
} from '@/hooks/useInventory';
import { cn } from '@/lib/utils';
import type { InventoryItem, StockMovementType } from '@/services/types';
import { useDetailMode } from '@/hooks/useMediaQuery';
import { useSessionStore } from '@/stores/session';
import { formatPeso } from '@pos/core/money';
import { formatQty } from '@pos/core/quantity';

export function InventoryDetailPage() {
  const params = useParams();
  const parsed = Number(params.productId);
  const productId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  const detail = useInventoryItem(productId);
  useShellHeader(detail.item ? detail.item.name : 'Stock detail');

  // MASTER §6: an order opened from the history is a right sheet at ≥ 1280 px and a full page below.
  const [order, setOrder] = useState<string | null>(null);
  const { canOpenOrders } = useInventoryPermissions();
  const detailMode = useDetailMode();
  const showPage = detailMode === 'page' && order !== null;

  return (
    <>
      <div hidden={showPage}>
        <PlainPage
          title={detail.item?.name ?? 'Stock detail'}
          subtitle={detail.item ? `${detail.item.category.name}${detail.item.sku ? ` · ${detail.item.sku}` : ''}` : null}
          actions={
            <Button asChild variant="outline">
              <Link to="/inventory">
                <ArrowLeftIcon aria-hidden="true" />
                Inventory
              </Link>
            </Button>
          }
        >
          <div className="flex w-full max-w-[960px] flex-col gap-4">
            {detail.loading ? (
              <Card>
                <LoadingRows rows={3} label="Loading the stock…" />
              </Card>
            ) : detail.item ? (
              <SummaryCard item={detail.item} />
            ) : (
              <Card>
                <ErrorState title="Couldn't load the stock" message={detail.error ?? 'Not found.'} onRetry={detail.reload} />
              </Card>
            )}
            {productId !== null ? <HistoryCard productId={productId} onOpenOrder={canOpenOrders ? setOrder : undefined} /> : null}
          </div>
        </PlainPage>
      </div>
      {canOpenOrders ? <OrderDetailSheet mode={detailMode} ulid={order} onClose={() => setOrder(null)} backLabel="Back to the stock" /> : null}
    </>
  );
}

function SummaryCard({ item }: { item: InventoryItem }) {
  const { canAdjust } = useInventoryPermissions();
  const notify = (notice: string) => toast.success(notice);
  const receipt = useStockDialog(item, 'receipt', notify);
  const count = useStockDialog(item, 'count', notify);
  const wastage = useStockDialog(item, 'wastage', notify);
  const adjustment = useStockDialog(item, 'adjustment', notify);
  const reorder = useReorderLevelDialog(item, notify);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Stock</h2>
        <ToneBadge info={STOCK_STATUS[item.status]} />
      </div>
      {!item.is_available ? <Banner variant="info">This product is unavailable on the POS.</Banner> : null}
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[13px] text-muted-foreground">On hand</dt>
          <dd className={cn('text-[32px] leading-tight font-bold tabular', item.qty <= 0 && 'text-danger')}>{formatQty(item.qty)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Reorder level</dt>
          <dd className="font-semibold tabular">{reorderText(item.reorder_level)}</dd>
          {canAdjust ? (
            <dd>
              <Button variant="link" size="sm" className="h-auto px-0" onClick={reorder.show}>
                <PencilIcon aria-hidden="true" />
                Edit
              </Button>
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Cost</dt>
          <dd className="font-semibold tabular">{formatPeso(item.cost_cents)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Stock value</dt>
          <dd className="font-semibold text-green tabular">{formatPeso(item.stock_value_cents)}</dd>
        </div>
      </dl>
      {canAdjust ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="green" onClick={receipt.show}>
            <ArrowDownToLine aria-hidden="true" />
            Stock in
          </Button>
          <Button variant="outline" onClick={count.show}>
            <ClipboardList aria-hidden="true" />
            Count
          </Button>
          <Button variant="outline" onClick={wastage.show}>
            <Trash2 aria-hidden="true" />
            Wastage
          </Button>
          <Button variant="outline" onClick={adjustment.show}>
            <ArrowUpDown aria-hidden="true" />
            Adjust stock
          </Button>
        </div>
      ) : null}
      {canAdjust ? (
        <>
          <ProductStockDialog dialog={receipt} item={item} />
          <ProductStockDialog dialog={count} item={item} />
          <ProductStockDialog dialog={wastage} item={item} />
          <ProductStockDialog dialog={adjustment} item={item} />
          <ProductReorderDialog dialog={reorder} item={item} />
        </>
      ) : null}
    </Card>
  );
}

function HistoryCard({ productId, onOpenOrder }: { productId: number; onOpenOrder?: (ulid: string) => void }) {
  const [type, setType] = useState<StockMovementType | null>(null);
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const history = useInventoryMovements(productId, type);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
        <h2 className="text-base font-semibold">History</h2>
        <div className="flex w-full flex-col gap-1.5 sm:w-48">
          <Label htmlFor="movement-type">Type</Label>
          <NativeSelect
            id="movement-type"
            value={type ?? ''}
            onChange={(event) => setType(event.target.value === '' ? null : (event.target.value as StockMovementType))}
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((entry) => (
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
        <EmptyState title={type ? 'No movements of this type' : 'No movements yet'} message="Stock in, sales, counts and wastage show here." />
      ) : (
        <>
          <ul aria-label="Stock movements">
            {history.items.map((movement) => (
              <ProductMovementRow key={movement.ulid} movement={movement} timeZone={timezone} onOpenOrder={onOpenOrder} />
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
