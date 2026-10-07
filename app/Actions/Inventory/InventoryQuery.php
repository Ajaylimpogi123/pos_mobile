<?php

namespace App\Actions\Inventory;

use App\Models\Product;
use App\Support\StockStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * The branch's stock of its tracked products (Inventory, v1 completion), shared by the
 * inventory list, the reorder-level response, the inventory report and the dashboard alerts.
 *
 * A product's level in the branch is LEFT JOINed (`stock_levels`), so a missing level counts
 * as qty 0 with no reorder level; the stock status is App\Support\StockStatus, in SQL.
 */
class InventoryQuery
{
    /**
     * The level's qty and reorder level, as joined by join().
     */
    public const QTY = 'stock_levels.qty';

    public const REORDER_LEVEL = 'stock_levels.reorder_level';

    /**
     * The branch's non-deleted `track_stock` products (unavailable ones included) as
     * InventoryItem models: `products.*` plus `level_qty` (int, 0 when missing),
     * `level_reorder_level` (int or null) and `last_movement_at` (the product's latest
     * movement in the branch, or null; one index lookup per row inside the same statement).
     *
     * @return Builder<Product>
     */
    public function items(int $branchId): Builder
    {
        $lastMovement = DB::table('stock_movements')
            ->selectRaw('MAX(stock_movements.occurred_at)')
            ->where('stock_movements.branch_id', $branchId)
            ->whereColumn('stock_movements.product_id', 'products.id');

        $query = Product::query()->where('products.track_stock', true);

        $this->join($query->getQuery(), $branchId);

        return $query
            ->select('products.*')
            ->selectRaw('CAST(COALESCE('.self::QTY.', 0) AS SIGNED) AS level_qty')
            ->addSelect(self::REORDER_LEVEL.' as level_reorder_level')
            ->selectSub($lastMovement, 'last_movement_at')
            ->withCasts([
                'level_qty' => 'integer',
                'level_reorder_level' => 'integer',
                'last_movement_at' => 'datetime',
            ]);
    }

    /**
     * Restrict a query that joins the level (items(), or the report) to a `status` filter
     * (`in_stock`, `low`, `out` or `alerts`), on the current status.
     *
     * @template TQuery of Builder<Product>|QueryBuilder
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
     * The whole branch's current stock: `tracked` (non-deleted `track_stock` products), `low`
     * and `out` (by StockStatus, so an `out` product isn't also `low`) and `stock_value_cents`
     * (Σ max(qty, 0) × the product's current cost). One aggregate query.
     *
     * @return array{tracked: int, low: int, out: int, stock_value_cents: int}
     */
    public function summary(int $branchId): array
    {
        $query = DB::table('products')
            ->where('products.track_stock', true)
            ->whereNull('products.deleted_at');

        $this->join($query, $branchId);

        $status = $this->statusSql();

        $row = $query
            ->selectRaw('COUNT(*) AS tracked')
            ->selectRaw("COALESCE(SUM(CASE WHEN {$status} = ? THEN 1 ELSE 0 END), 0) AS low", [StockStatus::LOW])
            ->selectRaw("COALESCE(SUM(CASE WHEN {$status} = ? THEN 1 ELSE 0 END), 0) AS `out`", [StockStatus::OUT])
            ->selectRaw('CAST(COALESCE(SUM(GREATEST(COALESCE('.self::QTY.', 0), 0) * products.cost_cents), 0) AS SIGNED) AS stock_value_cents')
            ->first();

        return [
            'tracked' => (int) ($row->tracked ?? 0),
            'low' => (int) ($row->low ?? 0),
            'out' => (int) ($row->out ?? 0),
            'stock_value_cents' => (int) ($row->stock_value_cents ?? 0),
        ];
    }

    /**
     * The status CASE expression over the joined level.
     */
    public function statusSql(): string
    {
        return StockStatus::sql(self::QTY, self::REORDER_LEVEL);
    }

    /**
     * LEFT JOIN the product's level in the branch.
     */
    public function join(QueryBuilder $query, int $branchId): QueryBuilder
    {
        return $query->leftJoin('stock_levels', function (JoinClause $join) use ($branchId) {
            $join->on('stock_levels.product_id', '=', 'products.id')
                ->where('stock_levels.branch_id', '=', $branchId);
        });
    }
}
