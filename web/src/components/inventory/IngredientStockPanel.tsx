/**
 * An ingredient's branch stock (§B, §D, §D1): on hand in the base unit (and a
 * friendlier unit), the status, the reorder level, the average cost and the
 * stock value, with the actions **Adjust stock**, **Count**, **Wastage**,
 * **Set cost** and the reorder level's **Edit** (`inventory.adjust`).
 * Used on the ingredient's inventory detail and on its edit page.
 */
import { ArrowUpDown, ClipboardList, PencilIcon, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ToneBadge } from '@/components/common/ToneBadge';
import { IngredientCostDialog, IngredientReorderDialog, IngredientStockDialog } from '@/components/inventory/IngredientStockDialogs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { averageCostText, ingredientReorderText, STOCK_STATUS } from '@/constants/inventoryLabels';
import { useIngredientCostDialog, useIngredientReorderDialog, useIngredientStockDialog } from '@/hooks/useIngredientStock';
import { cn } from '@/lib/utils';
import type { Ingredient } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatQty, friendlyQty, isQtyAtOrBelowZero } from '@pos/core/quantity';

type IngredientStockPanelProps = {
  item: Ingredient;
  canAdjust: boolean;
  /** Called with the updated ingredient after Set cost. */
  onCostSet?: (updated: Ingredient) => void;
  title?: string;
};

export function IngredientStockPanel({ item, canAdjust, onCostSet, title = 'Stock' }: IngredientStockPanelProps) {
  const adjust = useIngredientStockDialog(item, 'adjustment', (notice) => toast.success(notice));
  const count = useIngredientStockDialog(item, 'count', (notice) => toast.success(notice));
  const wastage = useIngredientStockDialog(item, 'wastage', (notice) => toast.success(notice));
  const reorder = useIngredientReorderDialog(item, (notice) => toast.success(notice));
  const cost = useIngredientCostDialog(item, (notice, updated) => {
    toast.success(notice);
    onCostSet?.(updated);
  });
  const friendly = friendlyQty(item.qty, item.base_unit);
  const status = STOCK_STATUS[item.status];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <ToneBadge info={status} />
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[13px] text-muted-foreground">On hand</dt>
          <dd className={cn('text-[26px] leading-tight font-bold tabular', isQtyAtOrBelowZero(item.qty) && 'text-danger')}>
            {formatQty(item.qty)} {item.base_unit}
          </dd>
          {friendly ? <dd className="text-[13px] text-muted-foreground tabular">{friendly}</dd> : null}
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Reorder level</dt>
          <dd className="font-semibold tabular">{ingredientReorderText(item)}</dd>
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
          <dt className="text-[13px] text-muted-foreground">Avg cost</dt>
          <dd className="font-semibold tabular">{averageCostText(item)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Stock value</dt>
          <dd className="font-semibold text-green tabular">{formatPeso(item.stock_value_cents)}</dd>
        </div>
      </dl>
      {canAdjust ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={adjust.show}>
            <ArrowUpDown aria-hidden="true" />
            Adjust stock
          </Button>
          <Button variant="outline" onClick={count.show}>
            <ClipboardList aria-hidden="true" />
            Count
          </Button>
          <Button variant="outline" onClick={wastage.show}>
            <Trash2 aria-hidden="true" />
            Wastage
          </Button>
          <Button variant="outline" onClick={cost.show}>
            <Tag aria-hidden="true" />
            Set cost
          </Button>
        </div>
      ) : null}
      {canAdjust ? (
        <>
          <IngredientStockDialog dialog={adjust} item={item} />
          <IngredientStockDialog dialog={count} item={item} />
          <IngredientStockDialog dialog={wastage} item={item} />
          <IngredientReorderDialog dialog={reorder} item={item} />
          <IngredientCostDialog dialog={cost} item={item} />
        </>
      ) : null}
    </Card>
  );
}
