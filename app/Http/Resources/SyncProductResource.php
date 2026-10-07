<?php

namespace App\Http\Resources;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `SyncProduct` object (GET /api/v1/sync/catalogue).
 *
 * Only `category_id` (no embedded category), unavailable products included, and
 * `cost_cents` is never sent, not even to admins. No `created_at`.
 *
 * @mixin Product
 */
class SyncProductResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'category_id' => (int) $this->category_id,
            'sku' => $this->sku,
            'name' => $this->name,
            'description' => $this->description,
            'price_cents' => (int) $this->price_cents,
            'is_vatable' => (bool) $this->is_vatable,
            'is_available' => (bool) $this->is_available,
            'track_stock' => (bool) $this->track_stock,
            'sort_order' => (int) $this->sort_order,
            'image_url' => $this->imageUrl(),
            'image_path' => $this->image_path,
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
