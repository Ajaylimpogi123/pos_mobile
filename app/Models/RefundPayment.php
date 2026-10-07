<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Money given back by a refund (Phase 7): cash from the refunding tablet's drawer, or GCash
 * sent back with its `reference_no`. `branch_id` and `business_date` (the refund's day) are
 * copied for the sales reports.
 *
 * @property int $id
 * @property int $refund_id
 * @property int $branch_id
 * @property string $business_date
 * @property string $method `cash` or `gcash`
 * @property int $amount_cents
 * @property string|null $reference_no
 */
class RefundPayment extends Model
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
            'branch_id' => 'integer',
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
}
