<?php

namespace App\Actions\Recipes;

use App\Models\StockLevel;
use Brick\Math\BigDecimal;
use Illuminate\Support\Collection;

/**
 * What a sale depletes from its `recipe` lines (RecipeStock::prepare()), read and locked inside
 * the sale's transaction before anything is written: each recipe product's components per 1
 * serving, and the branch levels of every component, row-locked.
 *
 * `components`: recipe product id → list of `{type, id, base_qty, unit_cost_cents}` (an `own`
 * product component's `unit_cost_cents` is its `cost_cents` at the time of sale; null for an
 * ingredient, which is valued at its level's `avg_cost`).
 */
final readonly class RecipeDepletion
{
    /**
     * @param  array<int, list<array{type: string, id: int, base_qty: BigDecimal, unit_cost_cents: int|null}>>  $components
     * @param  Collection<int, StockLevel>  $ingredientLevels  Keyed by ingredient id
     * @param  Collection<int, StockLevel>  $productLevels  Keyed by product id
     */
    public function __construct(
        public int $branchId,
        public array $components,
        public Collection $ingredientLevels,
        public Collection $productLevels,
    ) {}

    public static function none(int $branchId): self
    {
        return new self($branchId, [], collect(), collect());
    }

    public function isEmpty(): bool
    {
        return $this->components === [];
    }
}
