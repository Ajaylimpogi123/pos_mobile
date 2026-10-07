<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * One line of a goods receipt: the quantity received (negative for a correction, with a
 * reason) in the entered unit, its base quantity and its cost. Append-only.
 *
 * @property int $id
 * @property int $goods_receipt_id
 * @property int $purchase_order_line_id
 * @property string $qty
 * @property string $unit
 * @property string $unit_factor
 * @property string $base_qty
 * @property int $cost_cents
 * @property string|null $reason
 */
class GoodsReceiptLine extends Model
{
    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Goods receipts are append-only.'));
        static::deleting(fn () => throw new LogicException('Goods receipts are append-only.'));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'goods_receipt_id' => 'integer',
            'purchase_order_line_id' => 'integer',
            'cost_cents' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<GoodsReceipt, $this>
     */
    public function receipt(): BelongsTo
    {
        return $this->belongsTo(GoodsReceipt::class, 'goods_receipt_id');
    }

    /**
     * @return BelongsTo<PurchaseOrderLine, $this>
     */
    public function purchaseOrderLine(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrderLine::class);
    }
}
