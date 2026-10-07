<?php

namespace App\Http\Resources;

use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET /api/v1/orders (the contract's `OrderSummary`). Load `cashier`,
 * `customer`, `reviewer` and `payments` (the method is enough), and
 * `withSum('items', 'qty')`. `items_count` = Σ qty; `payment_methods` = the distinct
 * methods, sorted A→Z. Phase 5 adds the same offline fields as `Order`, Phase 6 its
 * `shift_ulid`, and Phase 7 its `refunded_cents` (`status` may now be `voided`, `refunded`
 * or `partially_refunded`).
 *
 * @mixin Order
 */
class OrderSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Order $order */
        $order = $this->resource;

        return [
            'ulid' => $order->ulid,
            'invoice_no' => $order->invoice_no,
            'order_no' => $order->order_no,
            'queue_no' => $order->queue_no,
            'table_no' => $order->table_no,
            'business_date' => $order->business_date,
            'status' => $order->status,
            'placed_at' => $order->placed_at->toIso8601ZuluString(),
            'cashier' => ['id' => $order->cashier->id, 'name' => $order->cashier->name],
            'customer' => $order->customer === null
                ? null
                : ['id' => $order->customer->id, 'full_name' => $order->customer->full_name],
            'items_count' => (int) $order->getAttribute('items_sum_qty'),
            'total_cents' => $order->total_cents,
            'payment_methods' => $order->payments->pluck('method')->unique()->sort()->values()->all(),
            ...OrderResource::offlineFields($order),
            // Phase 6: null only for orders placed before shifts existed.
            'shift_ulid' => $order->shift_ulid,
            // Phase 7: Σ of the order's refunds (a column, so no extra query).
            'refunded_cents' => $order->refunded_cents,
            // SC/PWD: whether the sale carries it.
            'has_sc_pwd' => $order->hasScPwd(),
        ];
    }
}
