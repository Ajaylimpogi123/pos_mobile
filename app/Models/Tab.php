<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * An open bill at a dine-in table (Dine-in Tables & Tabs → D). A tab is not an order:
 * settling it creates normal orders (`orders.tab_id`). Written only by the actions in
 * App\Actions\Tabs; never deleted.
 *
 * `open_table_id` equals `table_id` while the tab is `open` and is null otherwise; its
 * UNIQUE index keeps one open tab per table.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int $table_id
 * @property int|null $open_table_id
 * @property string $status
 * @property int $guests
 * @property int|null $customer_id
 * @property string|null $notes
 * @property int $rounds_count
 * @property int $opened_by
 * @property CarbonInterface $opened_at
 * @property int|null $closed_by
 * @property CarbonInterface|null $closed_at
 * @property int|null $merged_into_tab_id
 * @property int|null $device_id
 * @property CarbonInterface $updated_at
 */
class Tab extends Model
{
    public const STATUS_OPEN = 'open';

    public const STATUS_CLOSED = 'closed';

    public const STATUS_MERGED = 'merged';

    public const STATUS_CANCELLED = 'cancelled';

    /**
     * The most item lines a tab may hold.
     */
    public const MAX_LINES = 200;

    /**
     * Relations the Tab resource reads.
     */
    public const RESOURCE_RELATIONS = ['table', 'customer', 'opener', 'items.adder', 'orders', 'mergedInto'];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => self::STATUS_OPEN,
        'rounds_count' => 0,
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Tabs are never deleted.'));
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
            'open_table_id' => 'integer',
            'guests' => 'integer',
            'customer_id' => 'integer',
            'rounds_count' => 'integer',
            'opened_by' => 'integer',
            'opened_at' => 'datetime',
            'closed_by' => 'integer',
            'closed_at' => 'datetime',
            'merged_into_tab_id' => 'integer',
            'device_id' => 'integer',
        ];
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }

    /**
     * Σ remaining_qty of the loaded items.
     */
    public function remainingQty(): int
    {
        return (int) $this->items->sum(fn (TabItem $item) => $item->remainingQty());
    }

    /**
     * Σ unit_price_cents × remaining_qty of the loaded items (display only).
     */
    public function remainingCents(): int
    {
        return (int) $this->items->sum(fn (TabItem $item) => $item->unit_price_cents * $item->remainingQty());
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
     * @return BelongsTo<Customer, $this>
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class)->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function opener(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by')->withTrashed();
    }

    /**
     * The tab this one was merged into.
     *
     * @return BelongsTo<Tab, $this>
     */
    public function mergedInto(): BelongsTo
    {
        return $this->belongsTo(Tab::class, 'merged_into_tab_id');
    }

    /**
     * The lines, by round, then id.
     *
     * @return HasMany<TabItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(TabItem::class)->orderBy('round_no')->orderBy('id');
    }

    /**
     * The orders that settled this tab, oldest first.
     *
     * @return HasMany<Order, $this>
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class)->orderBy('id');
    }
}
