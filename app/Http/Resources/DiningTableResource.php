<?php

namespace App\Http\Resources;

use App\Models\DiningTable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's admin `DiningTable` object (Dine-in Tables & Tabs → B), with its floor plan
 * place (Table Management → B: `pos_x`/`pos_y` null = not placed).
 *
 * @mixin DiningTable
 */
class DiningTableResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var DiningTable $table */
        $table = $this->resource;

        return [
            'id' => $table->id,
            'name' => $table->name,
            'area' => $table->area,
            'seats' => $table->seats,
            'pos_x' => $table->pos_x,
            'pos_y' => $table->pos_y,
            'width' => $table->width,
            'height' => $table->height,
            'shape' => $table->shape,
            'sort_order' => $table->sort_order,
            'is_active' => $table->is_active,
            'updated_at' => $table->updated_at?->toIso8601ZuluString(),
        ];
    }
}
