<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Cash put into (`in`) or taken out of (`out`) a shift's drawer (Phase 6), recorded on the
 * tablet with its own ULID. Rows are inserted, never updated or deleted.
 *
 * @property int $id
 * @property string $ulid
 * @property string $shift_ulid
 * @property int $branch_id
 * @property string $type `in` or `out`
 * @property int $amount_cents Always positive; `type` gives the direction
 * @property string $reason
 * @property int $user_id
 * @property CarbonInterface $occurred_at
 */
class CashMovement extends Model
{
    public const TYPE_IN = 'in';

    public const TYPE_OUT = 'out';

    public const TYPES = [self::TYPE_IN, self::TYPE_OUT];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Cash movements are append-only.'));
        static::deleting(fn () => throw new LogicException('Cash movements are append-only.'));
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
            'amount_cents' => 'integer',
            'user_id' => 'integer',
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Shift, $this>
     */
    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class, 'shift_ulid', 'ulid');
    }

    /**
     * The user who handled the cash, soft-deleted included.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
