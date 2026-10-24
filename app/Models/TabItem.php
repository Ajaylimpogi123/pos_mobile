<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A line sent to the kitchen on a tab (Dine-in Tables & Tabs → D.4), with the product
 * snapshots taken when its round was sent: the settlement uses them as the price.
 * `remaining_qty` = qty − settled_qty − cancelled_qty.
 *
 * @property int $id
 * @property int $tab_id
 * @property int $round_no
 * @property int $product_id
 * @property string $product_name
 * @property int $category_id
 * @property string $category_name
 * @property string|null $sku
 * @property int $unit_price_cents
 * @property bool $is_vatable
 * @property int $qty
 * @property int $settled_qty
 * @property int $cancelled_qty
 * @property string|null $notes
 * @property int $added_by
 * @property CarbonInterface $added_at
 */
class TabItem extends Model
{
    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'settled_qty' => 0,
        'cancelled_qty' => 0,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'tab_id' => 'integer',
            'round_no' => 'integer',
            'product_id' => 'integer',
            'category_id' => 'integer',
            'unit_price_cents' => 'integer',
            'is_vatable' => 'boolean',
            'qty' => 'integer',
            'settled_qty' => 'integer',
            'cancelled_qty' => 'integer',
            'added_by' => 'integer',
            'added_at' => 'datetime',
        ];
    }

    public function remainingQty(): int
    {
        return $this->qty - $this->settled_qty - $this->cancelled_qty;
    }

    /**
     * @return BelongsTo<Tab, $this>
     */
    public function tab(): BelongsTo
    {
        return $this->belongsTo(Tab::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function adder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'added_by')->withTrashed();
    }
}
