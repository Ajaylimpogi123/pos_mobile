<?php

namespace App\Models;

use Database\Factories\DiningTableFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
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
 * @property int|null $pos_x Table Management → B: grid column; null with `pos_y` = not on the plan
 * @property int|null $pos_y Grid row; null with `pos_x` = not on the plan
 * @property int $width 1–6 cells
 * @property int $height 1–6 cells
 * @property string $shape `rect` or `round`
 * @property int $sort_order
 * @property bool $is_active
 */
#[Fillable(['name', 'area', 'seats', 'sort_order', 'is_active'])]
class DiningTable extends Model
{
    /** @use HasFactory<DiningTableFactory> */
    use HasFactory, SoftDeletes;

    /**
     * Table Management → B: each area's floor plan is a grid of 24 × 16 cells.
     */
    public const GRID_WIDTH = 24;

    public const GRID_HEIGHT = 16;

    public const MIN_SIZE = 1;

    public const MAX_SIZE = 6;

    public const SHAPES = ['rect', 'round'];

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'sort_order' => 0,
        'is_active' => true,
        'width' => 2,
        'height' => 2,
        'shape' => 'rect',
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
            'pos_x' => 'integer',
            'pos_y' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
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

    /**
     * The table's reservations (Table Management → E).
     *
     * @return HasMany<TableReservation, $this>
     */
    public function reservations(): HasMany
    {
        return $this->hasMany(TableReservation::class, 'table_id');
    }

    /**
     * The tables of an area (null = the tables with no area).
     *
     * @param  Builder<DiningTable>  $query
     */
    public function scopeInArea(Builder $query, ?string $area): void
    {
        $area === null ? $query->whereNull('area') : $query->where('area', $area);
    }

    /**
     * Whether the table is placed on its area's floor plan.
     */
    public function isPlaced(): bool
    {
        return $this->pos_x !== null && $this->pos_y !== null;
    }
}
