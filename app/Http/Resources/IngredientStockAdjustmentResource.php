<?php

namespace App\Http\Resources;

use App\Actions\Inventory\IngredientStockAdjustmentResult;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The 201 body of POST /api/v1/admin/ingredients/{ingredient}/stock-adjustments: the product
 * adjustment's fields for an ingredient, with base-unit quantities as strings (3 decimals), plus
 * the entered quantity and unit and the value moved: the movement item plus `ingredient_id` and
 * `qty_before` (Q-026):
 *
 * `{ ulid, ingredient_id, type, qty_delta, qty_before, qty_after, entered_qty, entered_unit,
 *    unit_cost_cents, value_cents, reason, occurred_at, created_by, reference }` (`reference` is
 *    always null for an adjustment)
 *
 * @property-read IngredientStockAdjustmentResult $resource
 */
class IngredientStockAdjustmentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var IngredientStockAdjustmentResult $result */
        $result = $this->resource;
        $movement = $result->movement;

        return [
            'ulid' => $movement->ulid,
            'ingredient_id' => $movement->ingredient_id,
            'type' => $movement->type,
            'qty_delta' => Quantity::format((string) $movement->qty_delta),
            'qty_before' => $result->qtyBefore,
            'qty_after' => $result->qtyAfter,
            'entered_qty' => $movement->entered_qty === null ? null : Quantity::format((string) $movement->entered_qty),
            'entered_unit' => $movement->entered_unit,
            'unit_cost_cents' => $movement->unit_cost_cents,
            'value_cents' => $movement->value_cents,
            'reason' => $movement->reason,
            'occurred_at' => $movement->occurred_at->toIso8601ZuluString(),
            'created_by' => $movement->creator === null
                ? null
                : ['id' => $movement->creator->id, 'name' => $movement->creator->name],
            'reference' => null,
        ];
    }
}
