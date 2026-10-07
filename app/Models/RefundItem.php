<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A line of a refund (Phase 7): how many units of which order line, and the amount (the
 * cumulative rounding of App\Support\Sales\RefundCalculator). `branch_id`, `business_date`
 * (the refund's day), `product_id` and `category_id` (the order line's snapshot) are copied
 * for the sales reports.
 *
 * @property int $id
 * @property int $refund_id
 * @property int $order_item_id
 * @property int $branch_id
 * @property string $business_date
 * @property int $product_id
 * @property int $category_id
 * @property string $qty Decimal string, whole units
 * @property int $amount_cents
 */
class RefundItem extends Model
{
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'refund_id' => 'integer',
            'order_item_id' => 'integer',
            'branch_id' => 'integer',
            'product_id' => 'integer',
            'category_id' => 'integer',
            'qty' => 'decimal:4',
            'amount_cents' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Refund, $this>
     */
    public function refund(): BelongsTo
    {
        return $this->belongsTo(Refund::class);
    }

    /**
     * @return BelongsTo<OrderItem, $this>
     */
    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }
}
