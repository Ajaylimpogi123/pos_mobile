<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * A purchase request (PR) of a branch (Ingredients, Recipes & Purchasing → F). Never deleted:
 * a cancel sets `status = cancelled`. `status` is derived from the items' decisions and stored.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property string $pr_no
 * @property int $requested_by
 * @property string $status
 * @property CarbonInterface|null $date_needed
 * @property string|null $remarks
 * @property int|null $cancelled_by
 * @property CarbonInterface|null $cancelled_at
 * @property CarbonInterface|null $created_at
 */
class PurchaseRequest extends Model
{
    public const STATUS_PENDING = 'pending_approval';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_PARTIALLY_APPROVED = 'partially_approved';

    public const STATUS_DECLINED = 'declined';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUSES = [
        self::STATUS_PENDING, self::STATUS_APPROVED, self::STATUS_PARTIALLY_APPROVED, self::STATUS_DECLINED, self::STATUS_CANCELLED,
    ];

    /**
     * What PurchaseRequestResource reads.
     *
     * @return array<int|string, mixed>
     */
    public static function resourceRelations(): array
    {
        return [
            'requester', 'items.ingredient', 'items.product', 'items.supplier', 'items.decider', 'purchaseOrder',
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
            'requested_by' => 'integer',
            'date_needed' => 'date',
            'cancelled_by' => 'integer',
            'cancelled_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class)->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by')->withTrashed();
    }

    /**
     * The items, in the order they were added.
     *
     * @return HasMany<PurchaseRequestItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(PurchaseRequestItem::class)->orderBy('id');
    }

    /**
     * The PO created when the last pending item was decided with any item approved.
     *
     * @return HasOne<PurchaseOrder, $this>
     */
    public function purchaseOrder(): HasOne
    {
        return $this->hasOne(PurchaseOrder::class);
    }

    /**
     * Whether any item has been decided (the PR is then being reviewed and locked).
     */
    public function hasDecisions(): bool
    {
        return $this->items()->where('decision', '!=', PurchaseRequestItem::DECISION_PENDING)->exists();
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
