<?php

namespace App\Actions\Inventory;

use App\Models\Ingredient;
use App\Support\StockStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * The branch's stock of its ingredients (Ingredients, Recipes & Purchasing → B, D), mirroring
 * InventoryQuery for products: shared by every `Ingredient` response, the ingredient inventory
 * list, the ingredient inventory report and the dashboard alerts.
 *
 * The ingredient's level in the branch is LEFT JOINed, so a missing level counts as qty 0, no
 * reorder level and `avg_cost` 0. The status is App\Support\StockStatus, in SQL. The stock
 * value is `round_half_up(max(qty, 0) × avg_cost, 0)` (exact DECIMAL arithmetic; MySQL's ROUND
 * of an exact positive value rounds half up).
 */
class IngredientInventoryQuery
{
    public const QTY = 'stock_levels.qty';

    public const REORDER_LEVEL = 'stock_levels.reorder_level';

    public const AVG_COST = 'stock_levels.avg_cost';

    /**
     * Every non-deleted ingredient (inactive ones included) with `level_qty`,
     * `level_reorder_level`, `level_avg_cost` (decimal strings or null) and `last_movement_at`
     * (the ingredient's latest movement in the branch, or null).
     *
     * @return Builder<Ingredient>
     */
    public function items(int $branchId): Builder
    {
        $lastMovement = DB::table('stock_movements')
            ->selectRaw('MAX('.$this->col('stock_movements.occurred_at').')')
            ->where('stock_movements.branch_id', $branchId)
            ->whereColumn('stock_movements.ingredient_id', 'ingredients.id');

        // `base_unit_locked` (Q-025): the ingredient is in use (IngredientUsage::isInUse), in any
        // branch: a movement, a PR item, a PO line or (Round B) a recipe line.
        $inUse = implode(' OR ', array_map(
            fn (string $table): string => 'EXISTS ('.DB::table($table)->selectRaw('1')->whereColumn("{$table}.ingredient_id", 'ingredients.id')->toSql().')',
            ['stock_movements', 'purchase_request_items', 'purchase_order_lines', 'recipe_lines'],
        ));

        $query = Ingredient::query();

        $this->join($query->getQuery(), $branchId);

        return $query
            ->select('ingredients.*')
            ->addSelect([
                self::QTY.' as level_qty',
                self::REORDER_LEVEL.' as level_reorder_level',
                self::AVG_COST.' as level_avg_cost',
            ])
            ->selectSub($lastMovement, 'last_movement_at')
            ->selectRaw("({$inUse}) AS base_unit_locked")
            ->withCasts(['last_movement_at' => 'datetime', 'base_unit_locked' => 'boolean']);
    }

    /**
     * Restrict a query that joins the level to a `status` filter (`in_stock`, `low`, `out` or
     * `alerts`), on the current status.
     *
     * @template TQuery of Builder<Ingredient>|QueryBuilder
     *
     * @param  TQuery  $query
     * @return TQuery
     */
    public function whereStatus(Builder|QueryBuilder $query, string $filter): Builder|QueryBuilder
    {
        $statuses = StockStatus::matching($filter);
        $placeholders = implode(', ', array_fill(0, count($statuses), '?'));

        return $query->whereRaw('('.$this->statusSql().") IN ({$placeholders})", $statuses);
    }

    /**
     * The whole branch's ingredients: `tracked` (non-deleted), `low`, `out` and
     * `stock_value_cents`. One aggregate query.
     *
     * @return array{tracked: int, low: int, out: int, stock_value_cents: int}
     */
    public function summary(int $branchId): array
    {
        $query = DB::table('ingredients')->whereNull('ingredients.deleted_at');

        $this->join($query, $branchId);

        $status = $this->statusSql();

        $row = $query
            ->selectRaw('COUNT(*) AS tracked')
            ->selectRaw("COALESCE(SUM(CASE WHEN {$status} = ? THEN 1 ELSE 0 END), 0) AS low", [StockStatus::LOW])
            ->selectRaw("COALESCE(SUM(CASE WHEN {$status} = ? THEN 1 ELSE 0 END), 0) AS `out`", [StockStatus::OUT])
            ->selectRaw('CAST(COALESCE(SUM('.$this->stockValueSql().'), 0) AS SIGNED) AS stock_value_cents')
            ->first();

        return [
            'tracked' => (int) ($row->tracked ?? 0),
            'low' => (int) ($row->low ?? 0),
            'out' => (int) ($row->out ?? 0),
            'stock_value_cents' => (int) ($row->stock_value_cents ?? 0),
        ];
    }

    public function statusSql(): string
    {
        return StockStatus::sql($this->col(self::QTY), $this->col(self::REORDER_LEVEL));
    }

    /**
     * round_half_up(max(qty, 0) × avg_cost, 0) of the joined level (0 when missing).
     */
    public function stockValueSql(): string
    {
        return 'ROUND(GREATEST(COALESCE('.$this->col(self::QTY).', 0), 0) * COALESCE('.$this->col(self::AVG_COST).', 0), 0)';
    }

    /**
     * A qualified column for a raw expression, wrapped by the query grammar so its table gets
     * the connection's table prefix, as the builder's own columns do.
     */
    public function col(string $column): string
    {
        return DB::getQueryGrammar()->wrap($column);
    }

    /**
     * LEFT JOIN the ingredient's level in the branch.
     */
    public function join(QueryBuilder $query, int $branchId): QueryBuilder
    {
        return $query->leftJoin('stock_levels', function (JoinClause $join) use ($branchId) {
            $join->on('stock_levels.ingredient_id', '=', 'ingredients.id')
                ->where('stock_levels.branch_id', '=', $branchId);
        });
    }
}
