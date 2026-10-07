<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * One receipt of goods against a purchase order (Ingredients, Recipes & Purchasing → H).
 * Append-only: receipts (and their lines) are the receiving history and audit trail; a
 * correction is a new receipt with a negative line.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int $purchase_order_id
 * @property int $received_by
 * @property CarbonInterface $received_at
 * @property string|null $remarks
 */
class GoodsReceipt extends Model
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
            'branch_id' => 'integer',
            'purchase_order_id' => 'integer',
            'received_by' => 'integer',
            'received_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<PurchaseOrder, $this>
     */
    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by')->withTrashed();
    }

    /**
     * @return HasMany<GoodsReceiptLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class)->orderBy('id');
    }
}
