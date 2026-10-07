<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * A cash shift of one tablet (Phase 6). Opened, given cash movements and closed through
 * the App\Actions\Shifts actions, from events the tablet made (possibly offline) with its
 * own ULIDs. A shift is open while `closed_at` is null; its report (X-read / Z-read) is
 * computed live by App\Actions\Shifts\BuildShiftReports. Shifts are never deleted.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int $device_id
 * @property CarbonInterface $opened_at
 * @property int $opened_by
 * @property int $opening_float_cents
 * @property CarbonInterface|null $closed_at
 * @property int|null $closed_by Null while open, and for an auto-closed shift
 * @property int|null $counted_cash_cents Null while open, and for an auto-closed shift
 * @property string|null $close_note
 * @property list<string> $flags FLAG_* values, in the order they were raised
 * @property CarbonInterface $synced_at When the server first received the shift
 */
class Shift extends Model
{
    public const STATUS_OPEN = 'open';

    public const STATUS_CLOSED = 'closed';

    public const STATUSES = [self::STATUS_OPEN, self::STATUS_CLOSED];

    /**
     * The tablet opened another shift while this one was open; this one was closed at the
     * other's `opened_at`, with no counted cash.
     */
    public const FLAG_AUTO_CLOSED = 'auto_closed';

    /**
     * A cash movement reached the server after the shift was closed.
     */
    public const FLAG_MOVEMENT_AFTER_CLOSE = 'movement_after_close';

    /**
     * Defaults of a new shift (the same as the column's default).
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'flags' => '[]',
    ];

    /**
     * The report computed for this instance (BuildShiftReports), never stored.
     *
     * @var array<string, mixed>|null
     */
    private ?array $computedReport = null;

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Shifts are never deleted.'));
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
            'device_id' => 'integer',
            'opened_at' => 'datetime',
            'opened_by' => 'integer',
            'opening_float_cents' => 'integer',
            'closed_at' => 'datetime',
            'closed_by' => 'integer',
            'counted_cash_cents' => 'integer',
            'flags' => 'array',
            'synced_at' => 'datetime',
        ];
    }

    public function isOpen(): bool
    {
        return $this->closed_at === null;
    }

    public function status(): string
    {
        return $this->isOpen() ? self::STATUS_OPEN : self::STATUS_CLOSED;
    }

    /**
     * Adds a flag once (a flag already raised is kept where it is). Not saved.
     */
    public function raiseFlag(string $flag): void
    {
        $flags = array_values($this->flags ?? []);

        if (! in_array($flag, $flags, true)) {
            $flags[] = $flag;
            $this->flags = $flags;
        }
    }

    /**
     * @param  array<string, mixed>  $report
     */
    public function setComputedReport(array $report): static
    {
        $this->computedReport = $report;

        return $this;
    }

    /**
     * The report set by BuildShiftReports.
     *
     * @return array<string, mixed>
     */
    public function computedReport(): array
    {
        return $this->computedReport ?? throw new LogicException('The shift report has not been computed.');
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class)->withTrashed();
    }

    /**
     * The tablet the shift belongs to, soft-deleted included.
     *
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class)->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function opener(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by')->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by')->withTrashed();
    }

    /**
     * @return HasMany<CashMovement, $this>
     */
    public function cashMovements(): HasMany
    {
        return $this->hasMany(CashMovement::class, 'shift_ulid', 'ulid')->orderBy('id');
    }
}
