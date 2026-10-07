<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * A purchase order (PO), one per purchase request (Ingredients, Recipes & Purchasing → G).
 * Never deleted. `status`: `pending_approval` → `approved` | `declined`; `receiving_status` is
 * derived from its lines' receiving statuses and stored.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property string $po_no
 * @property int $purchase_request_id
 * @property string $status
 * @property string $receiving_status
 * @property int $created_by
 * @property int|null $approved_by
 * @property CarbonInterface|null $approved_at
 * @property int|null $declined_by
 * @property CarbonInterface|null $declined_at
 * @property string|null $decline_reason
 * @property CarbonInterface|null $expected_delivery_date
 * @property string|null $remarks
 * @property int $total_cents Σ line_total_cents
 */
class PurchaseOrder extends Model
{
    public const STATUS_PENDING = 'pending_approval';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_DECLINED = 'declined';

    public const STATUSES = [self::STATUS_PENDING, self::STATUS_APPROVED, self::STATUS_DECLINED];

    public const RECEIVING_NONE = 'not_received';

    public const RECEIVING_PARTIAL = 'partially_received';

    public const RECEIVING_FULL = 'fully_received';

    public const RECEIVING_STATUSES = [self::RECEIVING_NONE, self::RECEIVING_PARTIAL, self::RECEIVING_FULL];

    /**
     * What PurchaseOrderResource reads.
     *
     * @return array<int|string, mixed>
     */
    public static function resourceRelations(): array
    {
        return [
            'purchaseRequest', 'creator', 'approver',
            'lines.ingredient', 'lines.product', 'lines.supplier',
            'receipts.receiver', 'receipts.lines',
            'auditLogs.actor' => fn ($query) => $query->withTrashed(),
        ];
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
            'purchase_request_id' => 'integer',
            'created_by' => 'integer',
            'approved_by' => 'integer',
            'approved_at' => 'datetime',
            'declined_by' => 'integer',
            'declined_at' => 'datetime',
            'expected_delivery_date' => 'date',
            'total_cents' => 'integer',
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
     * @return HasMany<PurchaseOrderLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseOrderLine::class)->orderBy('id');
    }

    /**
     * The receiving history, newest first.
     *
     * @return HasMany<GoodsReceipt, $this>
     */
    public function receipts(): HasMany
    {
        return $this->hasMany(GoodsReceipt::class)->orderByDesc('received_at')->orderByDesc('id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by')->withTrashed();
    }

    /**
     * The audit entries about this record, oldest first (the `timeline`).
     *
     * @return MorphMany<AuditLog, $this>
     */
    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'subject')->orderBy('id');
    }
}
