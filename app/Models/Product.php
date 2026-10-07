<?php

namespace App\Models;

use App\Models\Concerns\HasCatalogImage;
use Database\Factories\ProductFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A sellable menu item. Global master data (not branch-scoped), soft-deleted.
 * Money is integer centavos; `price_cents` is VAT-inclusive.
 *
 * @property int $id
 * @property int $category_id
 * @property string|null $sku
 * @property string $name
 * @property string|null $description
 * @property int $price_cents
 * @property int $cost_cents
 * @property bool $is_vatable
 * @property bool $is_available
 * @property string $stock_mode `own`, `recipe` or `none` (Ingredients, Recipes & Purchasing → J)
 * @property bool $track_stock Derived: `stock_mode == own` (a generated column; writing it maps onto `stock_mode`)
 * @property int $sort_order
 * @property string|null $image_path
 */
#[Fillable([
    'category_id', 'sku', 'name', 'description', 'price_cents', 'cost_cents',
    'is_vatable', 'is_available', 'stock_mode', 'track_stock', 'sort_order',
])]
class Product extends Model
{
    /** @use HasFactory<ProductFactory> */
    use HasCatalogImage, HasFactory, SoftDeletes;

    /**
     * Sold as-is from its own stock (Phase 3 stock: checked online, depleted on sale).
     */
    public const STOCK_OWN = 'own';

    /**
     * Made to order: a sale depletes its recipe's components (never checked, never blocks).
     */
    public const STOCK_RECIPE = 'recipe';

    public const STOCK_NONE = 'none';

    public const STOCK_MODES = [self::STOCK_OWN, self::STOCK_RECIPE, self::STOCK_NONE];

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'sku' => null,
        'description' => null,
        'cost_cents' => 0,
        'is_vatable' => true,
        'is_available' => true,
        'stock_mode' => self::STOCK_NONE,
        'sort_order' => 0,
        'image_path' => null,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'category_id' => 'integer',
            'price_cents' => 'integer',
            'cost_cents' => 'integer',
            'is_vatable' => 'boolean',
            'is_available' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    /**
     * `track_stock` (since Phase 1a) is `stock_mode == own`, for existing clients. Reading it
     * always derives it from `stock_mode`; writing it maps onto `stock_mode`: `true` → `own`,
     * `false` → `none` when the product was `own` (a `recipe` product stays `recipe`).
     *
     * @return Attribute<bool, bool>
     */
    protected function trackStock(): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value, array $attributes): bool => ($attributes['stock_mode'] ?? self::STOCK_NONE) === self::STOCK_OWN,
            set: fn (mixed $value, array $attributes): array => ['stock_mode' => match (true) {
                (bool) $value => self::STOCK_OWN,
                ($attributes['stock_mode'] ?? self::STOCK_NONE) === self::STOCK_OWN => self::STOCK_NONE,
                default => $attributes['stock_mode'] ?? self::STOCK_NONE,
            }],
        );
    }

    /**
     * The recipe's lines (per 1 serving), in the order entered. Used only while `stock_mode` is
     * `recipe`; kept but ignored otherwise.
     *
     * @return HasMany<RecipeLine, $this>
     */
    public function recipeLines(): HasMany
    {
        return $this->hasMany(RecipeLine::class)->orderBy('id');
    }

    /**
     * The product's category. Includes a soft-deleted category, so a product row
     * can always be rendered (deleting a category with products is blocked anyway).
     *
     * @return BelongsTo<Category, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class)->withTrashed();
    }

    /**
     * Cached quantities on hand, one per branch that ever stocked the product.
     *
     * @return HasMany<StockLevel, $this>
     */
    public function stockLevels(): HasMany
    {
        return $this->hasMany(StockLevel::class);
    }

    /**
     * The quantity on hand in a branch when the product tracks stock (0 if it was never
     * stocked there), otherwise null: the admin `Product.stock_qty` (Phase 3). Uses the
     * `stockLevels` relation when it is loaded (constrain it to the branch on lists).
     */
    public function stockQtyFor(int $branchId): ?int
    {
        if (! $this->track_stock) {
            return null;
        }

        $level = $this->relationLoaded('stockLevels')
            ? $this->stockLevels->firstWhere('branch_id', $branchId)
            : $this->stockLevels()->where('branch_id', $branchId)->first();

        return $level?->wholeQty() ?? 0;
    }
}
