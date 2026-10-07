<?php

namespace App\Http\Resources;

use App\Models\Refund;
use App\Models\RefundItem;
use App\Models\RefundPayment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Refund` object (Phase 7), inside `Order.refunds`. Load `refunder`,
 * `authorizer`, `items.orderItem` (for the line's product name snapshot) and `payments`.
 *
 * `business_date` is the refund's own business day; `authorized_by` is `null` when the
 * caller had `sale.refund`; `items[]` are in the order sent and `payments[]` cash first.
 *
 * @mixin Refund
 */
class RefundResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Refund $refund */
        $refund = $this->resource;

        return [
            'ulid' => $refund->ulid,
            'business_date' => $refund->business_date,
            'refunded_at' => $refund->refunded_at->toIso8601ZuluString(),
            'shift_ulid' => $refund->shift_ulid,
            'refunded_by' => ['id' => $refund->refunder->id, 'name' => $refund->refunder->name],
            'authorized_by' => $refund->authorizer === null
                ? null
                : ['id' => $refund->authorizer->id, 'name' => $refund->authorizer->name],
            'reason' => $refund->reason,
            'amount_cents' => $refund->amount_cents,
            'vatable_sales_cents' => $refund->vatable_sales_cents,
            'vat_amount_cents' => $refund->vat_amount_cents,
            'vat_exempt_sales_cents' => $refund->vat_exempt_sales_cents,
            'items' => $refund->items->map(fn (RefundItem $item) => [
                'order_item_id' => $item->order_item_id,
                'product_name' => $item->orderItem->product_name,
                'qty' => (int) $item->qty,
                'amount_cents' => $item->amount_cents,
            ])->values()->all(),
            'payments' => $refund->payments->map(fn (RefundPayment $payment) => [
                'method' => $payment->method,
                'amount_cents' => $payment->amount_cents,
                'reference_no' => $payment->reference_no,
            ])->values()->all(),
        ];
    }
}
