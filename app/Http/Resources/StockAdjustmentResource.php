<?php

namespace App\Http\Resources;

use App\Actions\Inventory\StockAdjustmentResult;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The 201 body of POST /api/v1/admin/products/{product}/stock-adjustments: the recorded
 * movement (`adjustment`, `receipt`, `count` or `wastage`; `type` is the stored type) with the
 * quantity on hand before and after it.
 *
 * @property-read StockAdjustmentResult $resource
 */
class StockAdjustmentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var StockAdjustmentResult $result */
        $result = $this->resource;
        $movement = $result->movement;

        return [
            'ulid' => $movement->ulid,
            'product_id' => $movement->product_id,
            'type' => $movement->type,
            'qty_delta' => $movement->wholeQtyDelta(),
            'qty_before' => $result->qtyBefore,
            'qty_after' => $result->qtyAfter,
            'reason' => $movement->reason,
            'occurred_at' => $movement->occurred_at->toIso8601ZuluString(),
            'created_by' => $movement->creator === null
                ? null
                : ['id' => $movement->creator->id, 'name' => $movement->creator->name],
        ];
    }
}
