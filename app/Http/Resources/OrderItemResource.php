<?php

namespace App\Http\Resources;

use App\Models\OrderItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A line of the contract's `Order` (`items[]`), from its sale-time snapshot. `category_id`
 * (Phase 4) is the product's category at the time of sale, used for printer routing.
 * `unit_cost_cents` is stored but never returned.
 *
 * @mixin OrderItem
 */
class OrderItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var OrderItem $item */
        $item = $this->resource;

        return [
            'id' => $item->id,
            'product_id' => $item->product_id,
            'product_name' => $item->product_name,
            'category_id' => $item->category_id,
            'category_name' => $item->category_name,
            'sku' => $item->sku,
            'qty' => (int) $item->qty,
            'unit_price_cents' => $item->unit_price_cents,
            'gross_cents' => $item->gross_cents,
            'is_vatable' => $item->is_vatable,
            'discount' => $item->lineDiscount()?->toArray(),
            'line_discount_cents' => $item->line_discount_cents,
            'order_discount_share_cents' => $item->order_discount_share_cents,
            'line_total_cents' => $item->line_total_cents,
            'notes' => $item->notes,
            // Phase 7: 0 when nothing was refunded.
            'refunded_qty' => $item->wholeRefundedQty(),
            'refunded_cents' => $item->refunded_cents,
            // SC/PWD: marked (or given a share in `headcount` mode), E_i, R_i and S_i.
            'sc_pwd' => $item->is_sc_pwd,
            'sc_pwd_eligible_cents' => $item->sc_pwd_eligible_cents,
            'sc_pwd_vat_relief_cents' => $item->sc_pwd_vat_relief_cents,
            'sc_pwd_discount_cents' => $item->sc_pwd_discount_cents,
        ];
    }
}
