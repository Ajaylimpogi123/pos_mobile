<?php

namespace App\Http\Resources;

use App\Models\Unit;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A catalog unit (GET /api/v1/units; Ingredients, Recipes & Purchasing → A):
 * `{ code, name, dimension, factor_to_base }`, the factor as an exact decimal string without
 * trailing zeros (`"28.349523125"`, `"1000"`). Per Q-025.
 *
 * @mixin Unit
 */
class UnitResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'code' => $this->code,
            'name' => $this->name,
            'dimension' => $this->dimension,
            'factor_to_base' => Quantity::normalize((string) $this->factor_to_base),
        ];
    }
}
