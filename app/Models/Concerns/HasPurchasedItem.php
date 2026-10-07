<?php

namespace App\Models\Concerns;

use App\Models\Ingredient;
use App\Models\Product;
use App\Models\Supplier;
use App\Support\Quantity;
use Brick\Math\BigNumber;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A purchase request item or purchase order line: an ingredient **or** a product (exactly one
 * of `ingredient_id` / `product_id`, a CHECK constraint), bought from a supplier, with the
 * entered `qty` + `unit`, the unit's `unit_factor` snapshot and `base_qty`.
 *
 * @property int|null $ingredient_id
 * @property int|null $product_id
 * @property int $supplier_id
 * @property string $qty
 * @property string $unit
 * @property string $unit_factor
 * @property string $base_qty
 */
trait HasPurchasedItem
{
    public const ITEM_INGREDIENT = 'ingredient';

    public const ITEM_PRODUCT = 'product';

    public function itemType(): string
    {
        return $this->ingredient_id !== null ? self::ITEM_INGREDIENT : self::ITEM_PRODUCT;
    }

    public function isIngredient(): bool
    {
        return $this->ingredient_id !== null;
    }

    public function itemId(): int
    {
        return (int) ($this->ingredient_id ?? $this->product_id);
    }

    /**
     * A quantity of this item as the API sends it: an ingredient's as a string with exactly 3
     * decimals, a product's as an integer (product quantities stay whole units).
     */
    public function presentQty(BigNumber|string|int $value): string|int
    {
        return $this->isIngredient() ? Quantity::format($value) : Quantity::round($value, 0)->toInt();
    }

    /**
     * `{ type, id, name }` of the item.
     *
     * @return array{type: string, id: int, name: string}
     */
    public function itemSummary(): array
    {
        return ['type' => $this->itemType(), 'id' => $this->itemId(), 'name' => $this->itemName()];
    }

    /**
     * The item's current name (soft-deleted items included).
     */
    public function itemName(): string
    {
        return (string) ($this->isIngredient() ? $this->ingredient?->name : $this->product?->name);
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
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Supplier, $this>
     */
    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }
}
