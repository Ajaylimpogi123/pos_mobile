<?php

namespace App\Actions\Reports;

use App\Actions\Inventory\IngredientInventoryQuery;
use App\Models\Branch;
use App\Models\StockMovement;
use App\Support\BusinessDay;
use App\Support\Quantity;
use App\Support\StockStatus;
use Brick\Math\BigDecimal;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The inventory report of ingredients (`GET /reports/inventory?kind=ingredients`; Ingredients,
 * Recipes & Purchasing → D), mirroring BuildInventoryReportAction: for every non-deleted
 * ingredient matching `status` (the **current** status), its flow over the period in its base
 * unit (strings with 3 decimals):
 *
 * - `opening_qty` = the ledger sum before the period;
 * - `received` = Σ receipt (corrections included); `used` = −Σ sale (recipe depletion included);
 *   `returned` = Σ void + refund; `wasted` = −Σ wastage; `adjusted` = Σ adjustment + count + opening
 *   + revaluation (D1: quantity 0; its `value_cents` counts in `value_in_cents` / `value_out_cents`);
 * - Round B: a refund's share of recipe components in the period (`refund_item_components`, no
 *   stock movement) moves from `used` to `wasted`, so nothing counts twice;
 * - `closing_qty` = opening + received − used + returned − wasted + adjusted (the invariant holds by
 *   construction);
 * - `value_in_cents` / `value_out_cents`: the period's movement values in (Σ positive
 *   `value_cents`) and out (−Σ negative ones);
 * - `reorder_level`, `status`, `avg_cost` and `stock_value_cents` describe now.
 *
 * `totals`: `tracked`, `low`, `out`, `stock_value_cents` (the whole branch, now) and
 * `value_in_cents`, `value_out_cents` (every matching ingredient, even when the rows are
 * truncated). Quantities aren't totalled: base units differ between ingredients. The row and
 * totals layout is provisional (Q-030).
 *
 * Set-based SQL: one statement for the rows and totals (the ledger grouped per ingredient and
 * type from the covering `stock_movements_ingredient_report_index`), one for the branch summary.
 * Rows are ordered by name, then id, capped at 500 (`truncated`).
 */
class BuildIngredientInventoryReportAction
{
    public const MAX_ROWS = 500;

    private const MOVEMENTS_INDEX = 'stock_movements_ingredient_report_index';

    /**
     * @var array<string, array{types: list<string>, sign: int}>
     */
    private const FLOWS = [
        'received' => ['types' => [StockMovement::TYPE_RECEIPT], 'sign' => 1],
        'used' => ['types' => [StockMovement::TYPE_SALE], 'sign' => -1],
        'returned' => ['types' => [StockMovement::TYPE_VOID, StockMovement::TYPE_REFUND], 'sign' => 1],
        'wasted' => ['types' => [StockMovement::TYPE_WASTAGE], 'sign' => -1],
        // D1: a revaluation belongs to `adjusted`; its qty_delta is 0, so only its value counts.
        'adjusted' => ['types' => [StockMovement::TYPE_ADJUSTMENT, StockMovement::TYPE_COUNT, StockMovement::TYPE_OPENING, StockMovement::TYPE_REVALUATION], 'sign' => 1],
    ];

    public function __construct(private readonly IngredientInventoryQuery $inventory) {}

    public function execute(int $branchId, string $from, string $to, ?string $status = null): InventoryReport
    {
        $businessDay = BusinessDay::forBranch(Branch::withTrashed()->find($branchId));
        $start = $businessDay->range($from)['start'];
        $end = $businessDay->range($to)['end'];

        $records = $this->rows($this->flows($branchId, $start, $end), $this->refundWaste($branchId, $start, $end), $branchId, $status)
            ->limit(self::MAX_ROWS + 1)
            ->get();

        $rows = $records->take(self::MAX_ROWS)->map(function (object $record): array {
            $flows = [];

            foreach (array_keys(self::FLOWS) as $column) {
                $flows[$column] = BigDecimal::of((string) ($record->{$column} ?? '0'));
            }

            // Round B: a refund's share of the recipe components moves from used to wasted.
            $refundWasted = BigDecimal::of((string) ($record->refund_wasted ?? '0'));
            $flows['used'] = $flows['used']->minus($refundWasted);
            $flows['wasted'] = $flows['wasted']->plus($refundWasted);

            $opening = BigDecimal::of((string) ($record->opening_qty ?? '0'));
            $closing = $opening->plus($flows['received'])->minus($flows['used'])->plus($flows['returned'])
                ->minus($flows['wasted'])->plus($flows['adjusted']);
            $qty = (string) ($record->qty ?? '0');
            $reorderLevel = $record->reorder_level === null ? null : Quantity::format((string) $record->reorder_level);
            $avgCost = (string) ($record->avg_cost ?? '0');

            return [
                'ingredient_id' => (int) $record->ingredient_id,
                'name' => (string) $record->name,
                'base_unit' => (string) $record->base_unit,
                'opening_qty' => Quantity::format($opening),
                ...array_map(fn (BigDecimal $value) => Quantity::format($value), $flows),
                'closing_qty' => Quantity::format($closing),
                'reorder_level' => $reorderLevel,
                'status' => StockStatus::ofDecimal($qty, $reorderLevel),
                'avg_cost' => Quantity::formatCost($avgCost),
                'stock_value_cents' => Quantity::roundToInt(Quantity::max(BigDecimal::of($qty), BigDecimal::zero())->multipliedBy($avgCost)),
                'value_in_cents' => (int) $record->value_in_cents,
                'value_out_cents' => (int) $record->value_out_cents,
            ];
        })->values()->all();

        $first = $records->first();
        $summary = $this->inventory->summary($branchId);

        return new InventoryReport(
            from: $from,
            to: $to,
            totals: [
                'tracked' => $summary['tracked'],
                'low' => $summary['low'],
                'out' => $summary['out'],
                'stock_value_cents' => $summary['stock_value_cents'],
                'value_in_cents' => $first === null ? 0 : (int) $first->total_value_in_cents,
                'value_out_cents' => $first === null ? 0 : (int) $first->total_value_out_cents,
            ],
            rows: $rows,
            truncated: $records->count() > self::MAX_ROWS,
            kind: InventoryReport::KIND_INGREDIENTS,
        );
    }

    /**
     * The branch's ingredient movements up to the end of the period, per ingredient.
     */
    private function flows(int $branchId, CarbonInterface $start, CarbonInterface $end): Builder
    {
        $grouped = DB::table('stock_movements')
            ->forceIndex(self::MOVEMENTS_INDEX)
            ->where('branch_id', $branchId)
            ->whereNotNull('ingredient_id')
            ->where('occurred_at', '<', $end)
            ->select(['ingredient_id', 'type'])
            ->selectRaw('SUM(CASE WHEN occurred_at < ? THEN qty_delta ELSE 0 END) AS before_qty', [$start])
            ->selectRaw('SUM(qty_delta) AS until_end_qty')
            ->selectRaw('SUM(CASE WHEN occurred_at >= ? AND value_cents > 0 THEN value_cents ELSE 0 END) AS value_in', [$start])
            ->selectRaw('SUM(CASE WHEN occurred_at >= ? AND value_cents < 0 THEN -value_cents ELSE 0 END) AS value_out', [$start])
            ->groupBy('ingredient_id', 'type');

        $query = DB::query()
            ->fromSub($grouped, 'ledger')
            ->groupBy('ingredient_id')
            ->select('ingredient_id')
            ->selectRaw('SUM(before_qty) AS opening_qty')
            ->selectRaw('SUM(value_in) AS value_in')
            ->selectRaw('SUM(value_out) AS value_out');

        foreach (self::FLOWS as $column => $flow) {
            $types = implode(', ', array_map(fn (string $type) => "'{$type}'", $flow['types']));
            $sign = $flow['sign'] < 0 ? '-' : '';

            $query->selectRaw("{$sign}SUM(CASE WHEN type IN ({$types}) THEN until_end_qty - before_qty ELSE 0 END) AS {$column}");
        }

        return $query;
    }

    /**
     * Round B: the refunded share of recipe components in the period, per ingredient
     * (`refund_item_components`, on the refund's time).
     */
    private function refundWaste(int $branchId, CarbonInterface $start, CarbonInterface $end): Builder
    {
        return DB::table('refund_item_components')
            ->where('branch_id', $branchId)
            ->whereNotNull('ingredient_id')
            ->where('occurred_at', '>=', $start)
            ->where('occurred_at', '<', $end)
            ->groupBy('ingredient_id')
            ->select('ingredient_id')
            ->selectRaw('SUM(base_qty) AS refund_wasted');
    }

    private function rows(Builder $flows, Builder $refundWaste, int $branchId, ?string $status): Builder
    {
        $query = DB::table('ingredients')
            ->leftJoinSub($flows, 'flows', 'flows.ingredient_id', '=', 'ingredients.id')
            ->leftJoinSub($refundWaste, 'refund_waste', 'refund_waste.ingredient_id', '=', 'ingredients.id');

        $this->inventory->join($query, $branchId);

        $query
            ->whereNull('ingredients.deleted_at')
            ->when($status !== null, fn (Builder $q) => $this->inventory->whereStatus($q, (string) $status))
            ->select(['ingredients.id as ingredient_id', 'ingredients.name', 'ingredients.base_unit'])
            ->selectRaw('COALESCE(flows.opening_qty, 0) AS opening_qty')
            ->selectRaw('COALESCE(refund_waste.refund_wasted, 0) AS refund_wasted')
            ->selectRaw('COALESCE('.IngredientInventoryQuery::QTY.', 0) AS qty')
            ->addSelect([IngredientInventoryQuery::REORDER_LEVEL.' as reorder_level', IngredientInventoryQuery::AVG_COST.' as avg_cost'])
            ->selectRaw('CAST(COALESCE(flows.value_in, 0) AS SIGNED) AS value_in_cents')
            ->selectRaw('CAST(COALESCE(flows.value_out, 0) AS SIGNED) AS value_out_cents')
            ->selectRaw('CAST(SUM(COALESCE(flows.value_in, 0)) OVER () AS SIGNED) AS total_value_in_cents')
            ->selectRaw('CAST(SUM(COALESCE(flows.value_out, 0)) OVER () AS SIGNED) AS total_value_out_cents');

        foreach (array_keys(self::FLOWS) as $column) {
            $query->selectRaw("COALESCE(flows.{$column}, 0) AS {$column}");
        }

        return $query->orderBy('ingredients.name')->orderBy('ingredients.id');
    }
}
