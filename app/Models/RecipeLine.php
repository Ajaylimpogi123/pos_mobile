<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One component of a `recipe` product per **1 serving** (Ingredients, Recipes & Purchasing → J):
 * an ingredient **or** an `own`-stock product (`component_product_id`), exactly one (a CHECK
 * constraint). Keeps the entered `qty` + `unit` and `base_qty` in the component's base unit (a
 * product's is whole `pc`). A recipe is replaced as a set (PUT …/recipe).
 *
 * @property int $id
 * @property int $product_id The recipe product
 * @property int|null $ingredient_id
 * @property int|null $component_product_id
 * @property string $qty Decimal string (3 decimals)
 * @property string $unit
 * @property string $base_qty Decimal string (3 decimals)
 */
class RecipeLine extends Model
{
    public const COMPONENT_INGREDIENT = 'ingredient';

    public const COMPONENT_PRODUCT = 'product';

    /**
     * At most this many lines per recipe.
     */
    public const MAX_LINES = 50;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'product_id' => 'integer',
            'ingredient_id' => 'integer',
            'component_product_id' => 'integer',
            'qty' => 'decimal:3',
            'base_qty' => 'decimal:3',
        ];
    }

    public function componentType(): string
    {
        return $this->ingredient_id !== null ? self::COMPONENT_INGREDIENT : self::COMPONENT_PRODUCT;
    }

    /**
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Product, $this>
     */
    public function componentProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'component_product_id')->withTrashed();
    }
}
