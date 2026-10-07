<?php

namespace App\Http\Resources;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Product` object. The `category` relation must be loaded.
 *
 * `cost_cents` and `stock_qty` are included only on the admin routes (`v1.admin.*`). On
 * the POS read endpoint the keys are absent (the contract's one exception to "keys
 * always present"), because cashiers must not see cost. `stock_qty` (Phase 3) is the
 * caller's branch quantity on hand when `track_stock` is true (0 if never stocked),
 * otherwise null; eager load `stockLevels` constrained to that branch on lists. Round B adds
 * `stock_mode` (`own`, `recipe`, `none`); `track_stock` stays as `stock_mode == own`.
 *
 * @mixin Product
 */
class ProductResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $admin = $request->routeIs('v1.admin.*');

        return [
            'id' => $this->id,
            'category' => [
                'id' => $this->category->id,
                'name' => $this->category->name,
            ],
            'sku' => $this->sku,
            'name' => $this->name,
            'description' => $this->description,
            'price_cents' => (int) $this->price_cents,
            'cost_cents' => $this->when($admin, fn () => (int) $this->cost_cents),
            'is_vatable' => (bool) $this->is_vatable,
            'is_available' => (bool) $this->is_available,
            'track_stock' => (bool) $this->track_stock,
            // Round B (Ingredients, Recipes & Purchasing → J; provisional placement, Q-031).
            'stock_mode' => $this->stock_mode,
            'stock_qty' => $this->when($admin, fn () => $this->stockQtyFor((int) $request->user()?->branch_id)),
            'sort_order' => (int) $this->sort_order,
            'image_url' => $this->imageUrl(),
            'image_path' => $this->image_path,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
