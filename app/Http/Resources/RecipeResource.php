<?php

namespace App\Http\Resources;

use App\Actions\Recipes\Recipe;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Recipe` (Ingredients, Recipes & Purchasing → J):
 *
 * `{ lines: [{ component: {type, id, name, base_unit}, qty, unit, base_qty, unit_cost,
 *    line_cost_cents }], cost_cents, price_cents, margin_bps }`
 *
 * An ingredient line's `qty` and `base_qty` are strings with 3 decimals; a product line's are
 * integers (Q-027). `unit_cost` is centavos per base unit, a string with 6 decimals (the
 * ingredient's `avg_cost`, or the product's `cost_cents`); provisional (Q-031). `margin_bps` is
 * null when the price or the cost is 0.
 *
 * @property Recipe $resource
 */
class RecipeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'lines' => array_map(fn (array $line) => [
                'component' => [
                    'type' => $line['component']['type'],
                    'id' => $line['component']['id'],
                    'name' => $line['component']['name'],
                    'base_unit' => $line['component']['base_unit'],
                ],
                'qty' => $line['qty'],
                'unit' => $line['unit'],
                'base_qty' => $line['base_qty'],
                'unit_cost' => $line['unit_cost'],
                'line_cost_cents' => $line['line_cost_cents'],
            ], $this->resource->lines),
            'cost_cents' => $this->resource->costCents,
            'price_cents' => $this->resource->priceCents,
            'margin_bps' => $this->resource->marginBps,
        ];
    }
}
