<?php

namespace App\Actions\Sync;

use App\Models\Product;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/v1/sync/stock (Phase 5): an advisory snapshot of the branch's stock for the
 * device's offline warnings. Every non-deleted `track_stock` product, ordered by id, with
 * its whole-unit quantity in the branch (a missing level is 0, and it may be negative) and
 * (Inventory, v1 completion) its reorder level (null when missing or unset).
 * Bounded by the catalogue, so it is not paginated. One query, plus (Round B) one for `recipes`.
 */
class PullStockAction
{
    public const RECIPE_OK = 'ok';

    public const RECIPE_CHECK = 'check';

    /**
     * @return array{levels: list<array{product_id: int, qty: int, reorder_level: int|null}>, recipes: list<array{product_id: int, status: string}>, server_time: CarbonImmutable}
     */
    public function execute(int $branchId): array
    {
        $serverTime = CarbonImmutable::now()->utc()->startOfSecond();

        $levels = Product::query()
            ->where('products.track_stock', true)
            ->leftJoin('stock_levels', function ($join) use ($branchId) {
                $join->on('stock_levels.product_id', '=', 'products.id')
                    ->where('stock_levels.branch_id', '=', $branchId);
            })
            ->orderBy('products.id')
            ->toBase()
            ->get(['products.id as product_id', 'stock_levels.qty as qty', 'stock_levels.reorder_level as reorder_level'])
            ->map(fn (object $row) => [
                'product_id' => (int) $row->product_id,
                'qty' => (int) ($row->qty ?? 0),
                'reorder_level' => $row->reorder_level === null ? null : (int) $row->reorder_level,
            ])
            ->values()
            ->all();

        return ['levels' => $levels, 'recipes' => $this->recipes($branchId), 'server_time' => $serverTime];
    }

    /**
     * Round B (Ingredients, Recipes & Purchasing → J, Sell badges): every non-deleted `recipe`
     * product, ordered by id, `check` when any of its components is `out` in the branch (qty ≤ 0;
     * a missing level is 0), otherwise `ok` (also without components). A product component counts
     * only while it is `own` (depletion skips it otherwise). One query.
     *
     * @return list<array{product_id: int, status: string}>
     */
    private function recipes(int $branchId): array
    {
        return DB::table('products')
            ->where('products.stock_mode', Product::STOCK_RECIPE)
            ->whereNull('products.deleted_at')
            ->leftJoin('recipe_lines', 'recipe_lines.product_id', '=', 'products.id')
            ->leftJoin('products as components', function (JoinClause $join) {
                $join->on('components.id', '=', 'recipe_lines.component_product_id')
                    ->where('components.stock_mode', '=', Product::STOCK_OWN);
            })
            ->leftJoin('stock_levels as ingredient_levels', function (JoinClause $join) use ($branchId) {
                $join->on('ingredient_levels.ingredient_id', '=', 'recipe_lines.ingredient_id')
                    ->where('ingredient_levels.branch_id', '=', $branchId);
            })
            ->leftJoin('stock_levels as product_levels', function (JoinClause $join) use ($branchId) {
                $join->on('product_levels.product_id', '=', 'components.id')
                    ->where('product_levels.branch_id', '=', $branchId);
            })
            ->groupBy('products.id')
            ->orderBy('products.id')
            ->select('products.id as product_id')
            ->selectRaw('MAX(CASE WHEN (recipe_lines.ingredient_id IS NOT NULL OR components.id IS NOT NULL)'
                .' AND COALESCE(ingredient_levels.qty, product_levels.qty, 0) <= 0 THEN 1 ELSE 0 END) AS has_out')
            ->get()
            ->map(fn (object $row) => [
                'product_id' => (int) $row->product_id,
                'status' => (int) $row->has_out === 1 ? self::RECIPE_CHECK : self::RECIPE_OK,
            ])
            ->values()
            ->all();
    }
}
