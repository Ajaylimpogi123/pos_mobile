<?php

namespace App\Models;

use App\Models\Concerns\HasPurchasedItem;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A line of a purchase order, keeping its own supplier. `received_base_qty` and
 * `received_cents` cache the sums of its append-only receipt lines (written in the same
 * transaction); `receiving_status` is derived from them and stored.
 *
 * @property int $id
 * @property int $purchase_order_id
 * @property int $purchase_request_item_id
 * @property int $unit_price_cents Per `unit`
 * @property int $line_total_cents round_half_up(unit_price_cents × qty, 0)
 * @property string $received_base_qty
 * @property int $received_cents
 * @property string $receiving_status
 * @property CarbonInterface|null $last_received_at
 */
class PurchaseOrderLine extends Model
{
    use HasPurchasedItem;

    public const RECEIVING_PENDING = 'pending';

    public const RECEIVING_PARTIAL = 'partial';

    public const RECEIVING_COMPLETE = 'complete';

    public const RECEIVING_OVER = 'over_received';

    public const RECEIVING_STATUSES = [self::RECEIVING_PENDING, self::RECEIVING_PARTIAL, self::RECEIVING_COMPLETE, self::RECEIVING_OVER];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purchase_order_id' => 'integer',
            'purchase_request_item_id' => 'integer',
            'ingredient_id' => 'integer',
            'product_id' => 'integer',
            'supplier_id' => 'integer',
            'unit_price_cents' => 'integer',
            'line_total_cents' => 'integer',
            'received_cents' => 'integer',
            'last_received_at' => 'datetime',
        ];
    }

    /**
     * The received quantity in the line's unit: round_half_up(received_base_qty / unit_factor, 3).
     */
    public function receivedQty(): BigDecimal
    {
        return self::receivedQtyOf((string) $this->received_base_qty, (string) $this->unit_factor);
    }

    /**
     * max(qty − received_qty, 0), in the line's unit.
     */
    public function remainingQty(): BigDecimal
    {
        return Quantity::max(BigDecimal::of((string) $this->qty)->minus($this->receivedQty()), BigDecimal::zero());
    }

    public static function receivedQtyOf(string $receivedBaseQty, string $unitFactor): BigDecimal
    {
        return BigDecimal::of($receivedBaseQty)->dividedBy($unitFactor, Quantity::SCALE, RoundingMode::HalfUp);
    }

    /**
     * `pending` (nothing received), `partial` (< ordered), `complete` (=) or `over_received`
     * (> ordered), comparing the received quantity in the line's unit (3 decimals) with the
     * ordered quantity.
     */
    public static function receivingStatusOf(BigDecimal $receivedQty, BigDecimal $orderedQty): string
    {
        return match (true) {
            $receivedQty->isZero() => self::RECEIVING_PENDING,
            $receivedQty->isLessThan($orderedQty) => self::RECEIVING_PARTIAL,
            $receivedQty->isEqualTo($orderedQty) => self::RECEIVING_COMPLETE,
            default => self::RECEIVING_OVER,
        };
    }

    /**
     * @return BelongsTo<PurchaseOrder, $this>
     */
    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }

    /**
     * @return BelongsTo<PurchaseRequestItem, $this>
     */
    public function purchaseRequestItem(): BelongsTo
    {
        return $this->belongsTo(PurchaseRequestItem::class);
    }

    /**
     * @return HasMany<GoodsReceiptLine, $this>
     */
    public function receiptLines(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class);
    }
}
