<?php

namespace App\Models;

use Database\Factories\DiningTableFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A dine-in table of a branch (Dine-in Tables & Tabs → B). Branch-scoped master data,
 * soft-deleted. Written only by the actions in App\Actions\Tabs (admin tables).
 *
 * @property int $id
 * @property int $branch_id
 * @property string $name Max 10, fits `orders.table_no`
 * @property string|null $area
 * @property string $area_sort Generated: COALESCE(area, ''), the cursor lists' sort key
 * @property int $seats
 * @property int $sort_order
 * @property bool $is_active
 */
#[Fillable(['name', 'area', 'seats', 'sort_order', 'is_active'])]
class DiningTable extends Model
{
    /** @use HasFactory<DiningTableFactory> */
    use HasFactory, SoftDeletes;

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'sort_order' => 0,
        'is_active' => true,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'seats' => 'integer',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * The table's open tab, or null when the table is free.
     *
     * @return HasOne<Tab, $this>
     */
    public function openTab(): HasOne
    {
        return $this->hasOne(Tab::class, 'open_table_id');
    }

    /**
     * Whether the table has an open tab.
     */
    public function hasOpenTab(): bool
    {
        return Tab::query()->where('open_table_id', $this->id)->exists();
    }
}
