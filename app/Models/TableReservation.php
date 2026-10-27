<?php

namespace App\Models;

use App\Support\BranchSettings;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Database\Factories\TableReservationFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * A reservation that holds a dine-in table (Table Management → E, TM2). Written only by the
 * actions in App\Actions\Reservations (and OpenTabAction, when it seats one); never deleted.
 *
 * A reservation takes its table for SLOT_MINUTES from `reserved_for`. While `booked`, it
 * holds its free table from `reservation_hold_minutes` (a branch setting) before its time
 * until its slot ends, and it is late LATE_MINUTES after its time (display only).
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int $table_id
 * @property string $guest_name
 * @property string|null $phone
 * @property int $party_size
 * @property CarbonInterface $reserved_for
 * @property string $business_date
 * @property string|null $notes
 * @property string $status
 * @property int|null $tab_id
 * @property string|null $cancel_reason
 * @property int $created_by
 * @property int|null $updated_by
 * @property int|null $status_changed_by
 * @property CarbonInterface|null $status_changed_at
 * @property CarbonInterface $updated_at
 */
class TableReservation extends Model
{
    /** @use HasFactory<TableReservationFactory> */
    use HasFactory;

    public const STATUS_BOOKED = 'booked';

    public const STATUS_SEATED = 'seated';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_NO_SHOW = 'no_show';

    public const STATUSES = [self::STATUS_BOOKED, self::STATUS_SEATED, self::STATUS_CANCELLED, self::STATUS_NO_SHOW];

    /**
     * How long a reservation takes its table, and the clash distance between two bookings.
     */
    public const SLOT_MINUTES = 120;

    /**
     * A booked reservation is late this long after its time (display only).
     */
    public const LATE_MINUTES = 15;

    /**
     * Relations the Reservation resource reads.
     */
    public const RESOURCE_RELATIONS = ['table', 'tab', 'creator'];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => self::STATUS_BOOKED,
    ];

    /**
     * The branch's `reservation_hold_minutes`, set by the caller to avoid a query per row.
     */
    private ?int $holdMinutes = null;

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Reservations are never deleted.'));
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
            'table_id' => 'integer',
            'party_size' => 'integer',
            'reserved_for' => 'datetime',
            'tab_id' => 'integer',
            'created_by' => 'integer',
            'updated_by' => 'integer',
            'status_changed_by' => 'integer',
            'status_changed_at' => 'datetime',
        ];
    }

    public function isBooked(): bool
    {
        return $this->status === self::STATUS_BOOKED;
    }

    /**
     * Use this hold (the branch's `reservation_hold_minutes`) for isHeld().
     */
    public function withHoldMinutes(int $minutes): static
    {
        $this->holdMinutes = $minutes;

        return $this;
    }

    /**
     * The hold set by withHoldMinutes(), else the branch's setting.
     */
    public function holdMinutes(): int
    {
        return $this->holdMinutes ??= BranchSettings::for(Branch::query()->findOrFail($this->branch_id))->reservationHoldMinutes();
    }

    /**
     * Booked and `reserved_for − hold ≤ now < reserved_for + SLOT_MINUTES`.
     */
    public function isHeld(?CarbonInterface $now = null): bool
    {
        $now ??= CarbonImmutable::now();
        $at = CarbonImmutable::instance($this->reserved_for);

        return $this->isBooked()
            && $at->subMinutes($this->holdMinutes())->lte($now)
            && $now->lt($at->addMinutes(self::SLOT_MINUTES));
    }

    /**
     * Booked and `now > reserved_for + LATE_MINUTES`.
     */
    public function isLate(?CarbonInterface $now = null): bool
    {
        $now ??= CarbonImmutable::now();

        return $this->isBooked() && $now->gt(CarbonImmutable::instance($this->reserved_for)->addMinutes(self::LATE_MINUTES));
    }

    /**
     * Booked reservations holding their table at `$now` with the given hold.
     *
     * @param  Builder<TableReservation>  $query
     */
    public function scopeHeld(Builder $query, int $holdMinutes, ?CarbonInterface $now = null): void
    {
        $now = CarbonImmutable::instance($now ?? now());

        $query->where('status', self::STATUS_BOOKED)
            ->where('reserved_for', '<=', $now->addMinutes($holdMinutes))
            ->where('reserved_for', '>', $now->subMinutes(self::SLOT_MINUTES));
    }

    /**
     * Booked reservations whose slot hasn't ended at `$now`.
     *
     * @param  Builder<TableReservation>  $query
     */
    public function scopeUpcoming(Builder $query, ?CarbonInterface $now = null): void
    {
        $now = CarbonImmutable::instance($now ?? now());

        $query->where('status', self::STATUS_BOOKED)
            ->where('reserved_for', '>', $now->subMinutes(self::SLOT_MINUTES));
    }

    /**
     * The table, soft-deleted included.
     *
     * @return BelongsTo<DiningTable, $this>
     */
    public function table(): BelongsTo
    {
        return $this->belongsTo(DiningTable::class, 'table_id')->withTrashed();
    }

    /**
     * The tab it was seated into.
     *
     * @return BelongsTo<Tab, $this>
     */
    public function tab(): BelongsTo
    {
        return $this->belongsTo(Tab::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
