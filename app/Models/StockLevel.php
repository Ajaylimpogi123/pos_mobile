<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * The cached quantity on hand of a product **or** an ingredient (exactly one of `product_id`
 * and `ingredient_id`, a CHECK constraint) in a branch. Written only together with a stock
 * movement, under a row lock (see App\Actions\Inventory\RecordStockMovementAction). A missing
 * row means 0.
 *
 * Ingredients (Ingredients, Recipes & Purchasing → B) keep `qty` and `reorder_level` in their
 * base unit (3 decimals) and `avg_cost`, the weighted-average cost in centavos per base unit
 * (6 decimals). Products keep whole units and their own `cost_cents` (`avg_cost` stays 0).
 *
 * @property int $id
 * @property int $branch_id
 * @property int|null $product_id
 * @property int|null $ingredient_id
 * @property string $qty Decimal string: whole units for a product, 3 decimals for an ingredient
 * @property int|null $reorder_level At or below it the item is `low` (Inventory); null = no alert. Whole
 *                                   units for a product (see rawReorderLevel() for an ingredient)
 * @property string $avg_cost Ingredients: centavos per base unit (6 decimals)
 */
class StockLevel extends Model
{
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'product_id' => 'integer',
            'ingredient_id' => 'integer',
            'qty' => 'decimal:3',
            'avg_cost' => 'decimal:6',
            'reorder_level' => 'integer',
        ];
    }

    /**
     * The quantity on hand in whole units (Phase 3 stock is whole units only).
     */
    public function wholeQty(): int
    {
        return (int) $this->qty;
    }

    /**
     * The branch's level of a product, row-locked (FOR UPDATE) until the caller's
     * transaction ends, created at 0 when it does not exist yet. The upsert takes the
     * exclusive lock itself, so two first-time writers cannot deadlock on the insert.
     */
    public static function lockOrCreate(int $branchId, int $productId): self
    {
        return self::lockOrCreateFor($branchId, 'product_id', $productId);
    }

    /**
     * The branch's level of an ingredient (Ingredients, Recipes & Purchasing), row-locked and
     * created at 0 (with `avg_cost` 0) as lockOrCreate() does for a product.
     */
    public static function lockOrCreateIngredient(int $branchId, int $ingredientId): self
    {
        return self::lockOrCreateFor($branchId, 'ingredient_id', $ingredientId);
    }

    /**
     * The branch's levels of several products or ingredients at once (Round B depletion), created
     * at 0 when missing and row-locked in id order: one upsert and one `SELECT … FOR UPDATE`.
     * Keyed by the product or ingredient id.
     *
     * @param  'product_id'|'ingredient_id'  $key
     * @param  list<int>  $ids
     * @return Collection<int, self>
     */
    public static function lockOrCreateMany(int $branchId, string $key, array $ids): Collection
    {
        if ($ids === []) {
            return collect();
        }

        if (DB::transactionLevel() === 0) {
            throw new LogicException('Stock levels must be locked inside a transaction.');
        }

        $ids = array_values(array_unique($ids));
        sort($ids);
        $now = now();

        DB::table('stock_levels')->upsert(
            array_map(fn (int $id) => ['branch_id' => $branchId, $key => $id, 'qty' => 0, 'created_at' => $now, 'updated_at' => $now], $ids),
            ['branch_id', $key],
            ['qty' => DB::raw('qty')],
        );

        return static::query()
            ->where('branch_id', $branchId)
            ->whereIn($key, $ids)
            ->orderBy($key)
            ->lockForUpdate()
            ->get()
            ->keyBy($key);
    }

    /**
     * The ingredient's reorder level as stored (a decimal string, 3 decimals), or null. The
     * `reorder_level` attribute is cast to whole units for products.
     */
    public function rawReorderLevel(): ?string
    {
        $value = $this->attributes['reorder_level'] ?? null;

        return $value === null ? null : (string) $value;
    }

    /**
     * @param  'product_id'|'ingredient_id'  $key
     */
    private static function lockOrCreateFor(int $branchId, string $key, int $id): self
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Stock levels must be locked inside a transaction.');
        }

        $now = now();

        DB::table('stock_levels')->upsert(
            [['branch_id' => $branchId, $key => $id, 'qty' => 0, 'created_at' => $now, 'updated_at' => $now]],
            ['branch_id', $key],
            ['qty' => DB::raw('qty')],
        );

        return static::query()
            ->where('branch_id', $branchId)
            ->where($key, $id)
            ->lockForUpdate()
            ->firstOrFail();
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
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
}
