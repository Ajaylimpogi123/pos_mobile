<?php

namespace App\Models;

use App\Models\Concerns\HasPurchasedItem;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * An item of a purchase request, decided on its own (approved, or declined with a reason).
 *
 * @property int $id
 * @property int $purchase_request_id
 * @property int|null $branch_id The PR's branch (for the purchasing report)
 * @property CarbonInterface|null $requested_at The PR's `created_at` (for the purchasing report)
 * @property int|null $purchase_order_line_id The item's PO line, once the PO exists
 * @property int|null $estimated_unit_price_cents Per entered unit
 * @property string|null $remarks
 * @property string $decision `pending`, `approved` or `declined`
 * @property string|null $decision_reason
 * @property int|null $decided_by
 * @property CarbonInterface|null $decided_at
 */
class PurchaseRequestItem extends Model
{
    use HasPurchasedItem;

    public const DECISION_PENDING = 'pending';

    public const DECISION_APPROVED = 'approved';

    public const DECISION_DECLINED = 'declined';

    public const DECISIONS = [self::DECISION_PENDING, self::DECISION_APPROVED, self::DECISION_DECLINED];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purchase_request_id' => 'integer',
            'branch_id' => 'integer',
            'requested_at' => 'datetime',
            'ingredient_id' => 'integer',
            'product_id' => 'integer',
            'supplier_id' => 'integer',
            'estimated_unit_price_cents' => 'integer',
            'decided_by' => 'integer',
            'purchase_order_line_id' => 'integer',
            'decided_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<PurchaseRequest, $this>
     */
    public function purchaseRequest(): BelongsTo
    {
        return $this->belongsTo(PurchaseRequest::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by')->withTrashed();
    }

    /**
     * @return HasOne<PurchaseOrderLine, $this>
     */
    public function purchaseOrderLine(): HasOne
    {
        return $this->hasOne(PurchaseOrderLine::class);
    }
}
