<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use LogicException;

/**
 * One row of the append-only stock ledger. Rows are inserted, never updated or deleted;
 * `stock_levels` caches their sum per branch and product, or (Ingredients, Recipes &
 * Purchasing) per branch and ingredient: exactly one of `product_id` and `ingredient_id` is set
 * (a CHECK constraint). An ingredient movement is in its base unit (3 decimals) and also keeps
 * the entered quantity and unit, and `value_cents`, the signed value it moved at the
 * weighted-average cost (a receipt: its cost).
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int|null $product_id
 * @property int|null $ingredient_id
 * @property string $type `sale`, `adjustment` or `opening` in Phase 3; `void` and `refund` since Phase 7;
 *                        `receipt`, `count` and `wastage` since Inventory (v1 completion); `revaluation`
 *                        (ingredients) since Ingredients, Recipes & Purchasing → D1
 * @property string $qty_delta Decimal string: whole units for a product, base units (3 decimals) for an ingredient
 * @property string|null $entered_qty The quantity as entered (ingredients), in `entered_unit`
 * @property string|null $entered_unit
 * @property int|null $unit_cost_cents
 * @property int|null $value_cents Ingredients: the signed value moved
 * @property string|null $reference_type
 * @property int|null $reference_id
 * @property string|null $reason
 * @property CarbonInterface $occurred_at
 * @property int|null $created_by
 */
class StockMovement extends Model
{
    public const TYPE_SALE = 'sale';

    public const TYPE_ADJUSTMENT = 'adjustment';

    public const TYPE_OPENING = 'opening';

    /**
     * Phase 7: a voided sale's stock coming back (positive, referencing the order).
     */
    public const TYPE_VOID = 'void';

    /**
     * Phase 7: a refund's stock coming back (positive, referencing the refund).
     */
    public const TYPE_REFUND = 'refund';

    /**
     * Inventory (v1 completion): stock in (positive, with its unit cost).
     */
    public const TYPE_RECEIPT = 'receipt';

    /**
     * Inventory (v1 completion): a stock count (the delta the server worked out).
     */
    public const TYPE_COUNT = 'count';

    /**
     * Inventory (v1 completion): spoilage (negative).
     */
    public const TYPE_WASTAGE = 'wastage';

    /**
     * Ingredients, Recipes & Purchasing → D1: a manual cost (`qty_delta` 0) that sets an
     * ingredient's `avg_cost`; `value_cents` is the change in the stock value. Ingredients only.
     */
    public const TYPE_REVALUATION = 'revaluation';

    /**
     * Every movement type, as in the `type` enum.
     */
    public const TYPES = [
        self::TYPE_SALE, self::TYPE_ADJUSTMENT, self::TYPE_OPENING, self::TYPE_VOID, self::TYPE_REFUND,
        self::TYPE_RECEIPT, self::TYPE_COUNT, self::TYPE_WASTAGE, self::TYPE_REVALUATION,
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Stock movements are append-only.'));
        static::deleting(fn () => throw new LogicException('Stock movements are append-only.'));
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
            'product_id' => 'integer',
            'ingredient_id' => 'integer',
            'qty_delta' => 'decimal:3',
            'entered_qty' => 'decimal:3',
            'unit_cost_cents' => 'integer',
            'value_cents' => 'integer',
            'reference_id' => 'integer',
            'occurred_at' => 'datetime',
            'created_by' => 'integer',
        ];
    }

    /**
     * The movement in whole units (Phase 3 stock is whole units only).
     */
    public function wholeQtyDelta(): int
    {
        return (int) $this->qty_delta;
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
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by')->withTrashed();
    }

    /**
     * The record that caused the movement (an order for a sale).
     *
     * @return MorphTo<Model, $this>
     */
    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
