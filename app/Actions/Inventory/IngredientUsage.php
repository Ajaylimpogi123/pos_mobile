<?php

namespace App\Actions\Inventory;

use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\PurchaseRequestItem;
use App\Models\RecipeLine;
use App\Models\StockMovement;
use Illuminate\Support\Str;

/**
 * Where an ingredient is used, for the guards of the ingredient admin endpoints (Ingredients,
 * Recipes & Purchasing → D, J).
 *
 * - **In use** (the base unit is then immutable): any stock movement, purchase request item,
 *   purchase order line or (Round B) recipe line, in any branch.
 * - **On a recipe** (it can't be deleted): a recipe line of a non-deleted product, whatever the
 *   product's stock mode (a `recipe` → other switch keeps the rows).
 * - **Open purchase order**: a PO that is neither declined nor fully received.
 * - **Open PO line** (its unit can't be removed, renamed or re-factored): a line not yet
 *   complete (`pending` or `partial`) on a PO that isn't declined.
 */
class IngredientUsage
{
    public function isInUse(int $ingredientId): bool
    {
        return StockMovement::query()->where('ingredient_id', $ingredientId)->exists()
            || PurchaseRequestItem::query()->where('ingredient_id', $ingredientId)->exists()
            || PurchaseOrderLine::query()->where('ingredient_id', $ingredientId)->exists()
            || RecipeLine::query()->where('ingredient_id', $ingredientId)->exists();
    }

    public function isOnRecipe(int $ingredientId): bool
    {
        return RecipeLine::query()
            ->where('ingredient_id', $ingredientId)
            ->whereHas('product', fn ($query) => $query->whereNull('products.deleted_at'))
            ->exists();
    }

    public function isOnOpenPurchaseOrder(int $ingredientId): bool
    {
        return PurchaseOrderLine::query()
            ->where('ingredient_id', $ingredientId)
            ->whereHas('purchaseOrder', fn ($query) => $query
                ->where('status', '!=', PurchaseOrder::STATUS_DECLINED)
                ->where('receiving_status', '!=', PurchaseOrder::RECEIVING_FULL))
            ->exists();
    }

    /**
     * The unit names (lowercased) on the ingredient's open PO lines.
     *
     * @return list<string>
     */
    public function openLineUnits(int $ingredientId): array
    {
        return PurchaseOrderLine::query()
            ->where('ingredient_id', $ingredientId)
            ->whereIn('receiving_status', [PurchaseOrderLine::RECEIVING_PENDING, PurchaseOrderLine::RECEIVING_PARTIAL])
            ->whereHas('purchaseOrder', fn ($query) => $query->where('status', '!=', PurchaseOrder::STATUS_DECLINED))
            ->distinct()
            ->pluck('unit')
            ->map(fn (string $unit) => Str::lower($unit))
            ->unique()
            ->values()
            ->all();
    }
}
