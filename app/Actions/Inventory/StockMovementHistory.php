<?php

namespace App\Actions\Inventory;

use App\Models\GoodsReceipt;
use App\Models\Refund;
use App\Models\StockMovement;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * A product's movement history in a branch (GET /api/v1/inventory/{product}/movements;
 * Inventory, v1 completion), newest first (`occurred_at` desc, then id desc), ready to be
 * cursor-paginated.
 *
 * `qty_after` is the running balance of the product's **whole** branch ledger in
 * (`occurred_at`, id) order: a SQL window function over a derived table, so the `type` filter
 * and the page (applied outside it) never change it. The derived table keeps the name
 * `stock_movements`, so the rows are StockMovement models. The creator and the reference
 * (the order of a sale or void; the refund, with its order, of a refund) are eager loaded.
 */
class StockMovementHistory
{
    /**
     * The ledger columns, in order (the ingredient history's UNION needs them spelled out).
     */
    private const COLUMNS = [
        'id', 'ulid', 'branch_id', 'product_id', 'ingredient_id', 'type', 'qty_delta', 'entered_qty',
        'entered_unit', 'unit_cost_cents', 'value_cents', 'reference_type', 'reference_id', 'reason',
        'occurred_at', 'created_by', 'created_at', 'updated_at',
    ];

    /**
     * @return Builder<StockMovement>
     */
    public function query(int $branchId, int $productId, ?string $type = null): Builder
    {
        $ledger = DB::table('stock_movements')
            ->where('branch_id', $branchId)
            ->where('product_id', $productId)
            ->select('stock_movements.*')
            ->selectRaw('CAST(SUM(qty_delta) OVER (ORDER BY occurred_at, id ROWS UNBOUNDED PRECEDING) AS SIGNED) AS qty_after');

        return StockMovement::query()
            ->fromSub($ledger, 'stock_movements')
            ->when($type !== null, fn (Builder $query) => $query->where('type', $type))
            ->with([
                'creator',
                'reference' => fn (MorphTo $morph) => $morph->morphWith([Refund::class => ['order']]),
            ])
            ->withCasts(['qty_after' => 'integer'])
            ->orderByDesc('occurred_at')
            ->orderByDesc('id');
    }

    /**
     * An ingredient's history in a branch (GET /api/v1/inventory/ingredients/{ingredient}/movements;
     * Ingredients, Recipes & Purchasing → D), the same way: `qty_after` is the running balance of
     * the whole branch ledger in base units (an exact DECIMAL sum), and the reference of a
     * receipt (the goods receipt, with its purchase order) is eager loaded too. Round B adds the
     * refunds' recipe waste as `wastage` entries that don't move the balance (refundWaste()).
     *
     * @return Builder<StockMovement>
     */
    public function forIngredient(int $branchId, int $ingredientId, ?string $type = null): Builder
    {
        $movements = DB::table('stock_movements')
            ->where('branch_id', $branchId)
            ->where('ingredient_id', $ingredientId)
            ->select(self::COLUMNS);

        $ledger = DB::query()
            ->fromSub($movements->unionAll($this->refundWaste($branchId, $ingredientId)), 'entries')
            ->select('entries.*')
            ->selectRaw('SUM(qty_delta) OVER (ORDER BY occurred_at, id ROWS UNBOUNDED PRECEDING) AS qty_after');

        return StockMovement::query()
            ->fromSub($ledger, 'stock_movements')
            ->when($type !== null, fn (Builder $query) => $query->where('type', $type))
            ->with([
                'creator',
                'reference' => fn (MorphTo $morph) => $morph->morphWith([
                    Refund::class => ['order'],
                    GoodsReceipt::class => ['purchaseOrder'],
                ]),
            ])
            ->orderByDesc('occurred_at')
            ->orderByDesc('id');
    }

    /**
     * Round B: each refund's share of the ingredient's recipe components (no stock moved) as a
     * history entry per refund: `type` `wastage`, `qty_delta` 0 (the balance doesn't change; the
     * sale already deducted it), the wasted quantity as `entered_qty` in the base unit,
     * `value_cents` 0, the reason `Refund INV-…: <reason>`, at the refund's time, by the refunder,
     * referencing the refund. `id` is negative (−the first row's id), so it never collides with a
     * movement's and the cursor stays unique. Provisional (Q-031).
     */
    private function refundWaste(int $branchId, int $ingredientId): QueryBuilder
    {
        // Qualified columns inside raw expressions go through the grammar (table prefix).
        $col = fn (string $column): string => DB::getQueryGrammar()->wrap($column);

        return DB::table('refund_item_components')
            ->join('refunds', 'refunds.id', '=', 'refund_item_components.refund_id')
            ->join('orders', 'orders.id', '=', 'refunds.order_id')
            ->join('ingredients', 'ingredients.id', '=', 'refund_item_components.ingredient_id')
            ->where('refund_item_components.branch_id', $branchId)
            ->where('refund_item_components.ingredient_id', $ingredientId)
            ->groupBy(
                'refunds.id', 'refunds.ulid', 'refunds.reason', 'refunds.refunded_at', 'refunds.refunded_by',
                'orders.invoice_no', 'orders.order_no', 'ingredients.base_unit',
            )
            ->selectRaw('-MIN('.$col('refund_item_components.id').') AS id')
            ->addSelect('refunds.ulid as ulid')
            ->selectRaw('? AS branch_id', [$branchId])
            ->selectRaw('NULL AS product_id')
            ->selectRaw('? AS ingredient_id', [$ingredientId])
            ->selectRaw('? AS type', [StockMovement::TYPE_WASTAGE])
            ->selectRaw('CAST(0 AS DECIMAL(15,3)) AS qty_delta')
            ->selectRaw('SUM('.$col('refund_item_components.base_qty').') AS entered_qty')
            ->addSelect('ingredients.base_unit as entered_unit')
            ->selectRaw('NULL AS unit_cost_cents')
            ->selectRaw('0 AS value_cents')
            ->selectRaw('? AS reference_type', [(new Refund)->getMorphClass()])
            ->addSelect('refunds.id as reference_id')
            ->selectRaw("CONCAT('Refund ', COALESCE({$col('orders.invoice_no')}, {$col('orders.order_no')}), ': ', {$col('refunds.reason')}) AS reason")
            ->addSelect(['refunds.refunded_at as occurred_at', 'refunds.refunded_by as created_by'])
            ->selectRaw('MIN('.$col('refund_item_components.created_at').') AS created_at')
            ->selectRaw('MIN('.$col('refund_item_components.updated_at').') AS updated_at');
    }
}
