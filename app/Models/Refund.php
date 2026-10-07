<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * A refund of an order, full or partial (Phase 7). Written only by
 * App\Actions\Sales\RefundOrderAction, in one transaction with its lines, its payments, the
 * order's refunded amounts and status, and its `refund` stock movements. Never deleted.
 *
 * `business_date` is the business day of the refund (not of the sale), and `shift_ulid` the
 * refunding tablet's shift: refunds count on their own day and shift in every sales figure.
 *
 * @property int $id
 * @property string $ulid
 * @property int $order_id
 * @property int $branch_id
 * @property string $business_date
 * @property string $shift_ulid
 * @property int $device_id
 * @property int $refunded_by
 * @property int|null $authorized_by The approver when a manager PIN was used
 * @property string $reason
 * @property int $amount_cents
 * @property int $vatable_sales_cents
 * @property int $vat_amount_cents
 * @property int $vat_exempt_sales_cents
 * @property CarbonInterface $refunded_at
 */
class Refund extends Model
{
    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Refunds are never deleted.'));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'order_id' => 'integer',
            'branch_id' => 'integer',
            'device_id' => 'integer',
            'refunded_by' => 'integer',
            'authorized_by' => 'integer',
            'amount_cents' => 'integer',
            'vatable_sales_cents' => 'integer',
            'vat_amount_cents' => 'integer',
            'vat_exempt_sales_cents' => 'integer',
            'refunded_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * The user who made the refund request, soft-deleted users included.
     *
     * @return BelongsTo<User, $this>
     */
    public function refunder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'refunded_by')->withTrashed();
    }

    /**
     * The manager who approved the refund with their PIN, soft-deleted included.
     *
     * @return BelongsTo<User, $this>
     */
    public function authorizer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'authorized_by')->withTrashed();
    }

    /**
     * The refunding tablet, soft-deleted included.
     *
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class)->withTrashed();
    }

    /**
     * The lines, in the order sent.
     *
     * @return HasMany<RefundItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(RefundItem::class)->orderBy('id');
    }

    /**
     * The money given back, cash first (stored in that order).
     *
     * @return HasMany<RefundPayment, $this>
     */
    public function payments(): HasMany
    {
        return $this->hasMany(RefundPayment::class)->orderBy('id');
    }
}
