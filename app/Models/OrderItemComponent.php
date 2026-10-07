<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * The depletion snapshot of a sold `recipe` line (Ingredients, Recipes & Purchasing → J): one row
 * per order line and component (an ingredient **or** an `own` product, a CHECK constraint), with
 * `base_qty` for the whole line (the component's base_qty per serving × the line qty) and
 * `cost_cents`, its value at the time of sale. A void returns `base_qty` at `cost_cents`; each
 * refund adds its share to `wasted_base_qty` (cumulative) and records it in
 * `refund_item_components`.
 *
 * @property int $id
 * @property int $order_id
 * @property int $order_item_id
 * @property int $branch_id
 * @property int|null $ingredient_id
 * @property int|null $product_id The component product
 * @property string $base_qty Decimal string (3 decimals)
 * @property int $cost_cents
 * @property string $wasted_base_qty Decimal string (3 decimals)
 */
class OrderItemComponent extends Model
{
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'order_id' => 'integer',
            'order_item_id' => 'integer',
            'branch_id' => 'integer',
            'ingredient_id' => 'integer',
            'product_id' => 'integer',
            'base_qty' => 'decimal:3',
            'cost_cents' => 'integer',
            'wasted_base_qty' => 'decimal:3',
        ];
    }
}
