<?php

namespace App\Http\Resources;

use App\Models\Product;
use App\Support\StockStatus;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `InventoryItem` (Inventory, v1 completion): a tracked product with its stock
 * in the caller's branch. Wraps a Product from App\Actions\Inventory\InventoryQuery::items()
 * (with `level_qty`, `level_reorder_level` and `last_movement_at`); the `category` relation
 * must be loaded.
 *
 * - `qty` is an integer and can be negative; `status` is App\Support\StockStatus.
 * - `stock_value_cents` = max(qty, 0) × the product's current `cost_cents`.
 * - `last_movement_at` is null when the product has no movement in the branch.
 *
 * @mixin Product
 */
class InventoryItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $qty = (int) $this->level_qty;
        $reorderLevel = $this->level_reorder_level === null ? null : (int) $this->level_reorder_level;
        $cost = (int) $this->cost_cents;
        $lastMovementAt = $this->last_movement_at;

        return [
            'product_id' => $this->id,
            'name' => $this->name,
            'sku' => $this->sku,
            'category' => [
                'id' => $this->category->id,
                'name' => $this->category->name,
            ],
            'image_url' => $this->imageUrl(),
            'is_available' => (bool) $this->is_available,
            'qty' => $qty,
            'reorder_level' => $reorderLevel,
            'status' => StockStatus::of($qty, $reorderLevel),
            'cost_cents' => $cost,
            'stock_value_cents' => max($qty, 0) * $cost,
            'last_movement_at' => $lastMovementAt instanceof CarbonInterface ? $lastMovementAt->toIso8601ZuluString() : null,
        ];
    }
}
