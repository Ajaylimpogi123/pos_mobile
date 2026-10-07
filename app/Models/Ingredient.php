<?php

namespace App\Models;

use App\Models\Concerns\HasCatalogImage;
use Database\Factories\IngredientFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * An ingredient (Ingredients, Recipes & Purchasing → A, D). Global master data, soft-deleted,
 * with one base unit (`g`, `mL` or `pc`) in which its stock, cost and ledger are kept, and its
 * own units (`units`: 1 name = factor × the base unit). Its stock per branch lives on
 * `stock_levels` (with `avg_cost`), written only with a ledger movement.
 *
 * @property int $id
 * @property string $name
 * @property string $base_unit
 * @property string|null $image_path
 * @property bool $is_active
 */
#[Fillable(['name', 'base_unit', 'is_active'])]
class Ingredient extends Model
{
    /** @use HasFactory<IngredientFactory> */
    use HasCatalogImage, HasFactory, SoftDeletes;

    /**
     * The base units and their dimensions.
     */
    public const BASE_UNITS = ['g' => Unit::DIMENSION_MASS, 'mL' => Unit::DIMENSION_VOLUME, 'pc' => Unit::DIMENSION_COUNT];

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'image_path' => null,
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
            'is_active' => 'boolean',
        ];
    }

    /**
     * The dimension of the base unit (`mass`, `volume` or `count`).
     */
    public function dimension(): string
    {
        return self::BASE_UNITS[$this->base_unit];
    }

    /**
     * The ingredient's own units, oldest first.
     *
     * @return HasMany<IngredientUnit, $this>
     */
    public function units(): HasMany
    {
        return $this->hasMany(IngredientUnit::class)->orderBy('id');
    }

    /**
     * Cached quantities on hand, one per branch that ever stocked the ingredient.
     *
     * @return HasMany<StockLevel, $this>
     */
    public function stockLevels(): HasMany
    {
        return $this->hasMany(StockLevel::class);
    }
}
