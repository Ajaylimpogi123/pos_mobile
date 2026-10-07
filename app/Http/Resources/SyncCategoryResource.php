<?php

namespace App\Http\Resources;

use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `SyncCategory` object (GET /api/v1/sync/catalogue).
 *
 * Inactive categories are included; the device hides them. There is no
 * `products_count` (the device counts locally) and no `created_at`.
 *
 * @mixin Category
 */
class SyncCategoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'sort_order' => (int) $this->sort_order,
            'is_active' => (bool) $this->is_active,
            'image_url' => $this->imageUrl(),
            'image_path' => $this->image_path,
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
