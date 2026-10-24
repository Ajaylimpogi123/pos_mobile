<?php

namespace App\Actions\Reports;

use App\Actions\Inventory\InventoryQuery;
use App\Models\Branch;
use App\Models\StockMovement;
use App\Support\BusinessDay;
use App\Support\StockStatus;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The inventory report (Inventory, v1 completion): for every tracked product of the branch
 * matching the filters (`category_id`, and `status` on the **current** status), its stock
 * flow over the period `from`..`to` (from the start of the `from` business day to the end of
 * the `to` business day, in the branch timezone and day start):
 *
 * - `opening_qty` = the ledger sum before the period;
 * - `received` = Σ receipt; `sold` = −Σ sale; `returned` = Σ void + refund;
 *   `wasted` = −Σ wastage; `adjusted` = Σ adjustment + count + opening;
 * - `closing_qty` = opening + received − sold + returned − wasted + adjusted (the invariant
 *   holds by construction);
 * - `reorder_level`, `status`, `unit_cost_cents` (the product's current cost) and
 *   `stock_value_cents` describe now.
 *
 * Set-based SQL, whatever the data size: **one** statement for the rows and their flow
 * totals (the movements up to the end of the period summed per product and type with
 * conditional aggregation in derived tables, streamed from the covering
 * `stock_movements_inventory_report_index`;
 * the totals are window sums over every matching product, computed before the 500-row limit)
 * and **one** for the branch-wide stock (InventoryQuery::summary). No per-row queries.
 * Rows are ordered by name, then id, capped at 500 (`truncated`).
 */
class BuildInventoryReportAction
{
    public const MAX_ROWS = 500;

    /**
     * The covering index of the movements query (Inventory migration).
     */
    private const MOVEMENTS_INDEX = 'stock_movements_inventory_report_index';

    /**
     * The flow columns: the movement types each sums, and its sign.
     *
     * @var array<string, array{types: list<string>, sign: int}>
     */
    private const FLOWS = [
        'received' => ['types' => [StockMovement::TYPE_RECEIPT], 'sign' => 1],
        'sold' => ['types' => [StockMovement::TYPE_SALE], 'sign' => -1],
        'returned' => ['types' => [StockMovement::TYPE_VOID, StockMovement::TYPE_REFUND], 'sign' => 1],
        'wasted' => ['types' => [StockMovement::TYPE_WASTAGE], 'sign' => -1],
        'adjusted' => ['types' => [StockMovement::TYPE_ADJUSTMENT, StockMovement::TYPE_COUNT, StockMovement::TYPE_OPENING], 'sign' => 1],
    ];

    public function __construct(private readonly InventoryQuery $inventory) {}

    public function execute(int $branchId, string $from, string $to, ?int $categoryId = null, ?string $status = null): InventoryReport
    {
        $businessDay = BusinessDay::forBranch(Branch::withTrashed()->find($branchId));
        $start = $businessDay->range($from)['start'];
        $end = $businessDay->range($to)['end'];

        $records = $this->rows($this->flows($branchId, $start, $end), $branchId, $categoryId, $status)
            ->limit(self::MAX_ROWS + 1)
            ->get();

        $rows = $records->take(self::MAX_ROWS)->map(function (object $record): array {
            $qty = (int) $record->qty;
            $reorderLevel = $record->reorder_level === null ? null : (int) $record->reorder_level;
            $cost = (int) $record->cost_cents;

            $flows = array_map(fn (string $column) => (int) $record->{$column}, array_combine(array_keys(self::FLOWS), array_keys(self::FLOWS)));
            $opening = (int) $record->opening_qty;

            return [
                'product_id' => (int) $record->product_id,
                'name' => (string) $record->name,
                'category_name' => (string) $record->category_name,
                'opening_qty' => $opening,
                ...$flows,
                'closing_qty' => $opening + $flows['received'] - $flows['sold'] + $flows['returned'] - $flows['wasted'] + $flows['adjusted'],
                'reorder_level' => $reorderLevel,
                'status' => StockStatus::of($qty, $reorderLevel),
                'unit_cost_cents' => $cost,
                'stock_value_cents' => max($qty, 0) * $cost,
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
                ...array_map(fn (string $column) => $first === null ? 0 : (int) $first->{"total_{$column}"}, array_combine(array_keys(self::FLOWS), array_keys(self::FLOWS))),
            ],
            rows: $rows,
            truncated: $records->count() > self::MAX_ROWS,
        );
    }

    /**
     * The branch's movements up to the end of the period, per product: `opening_qty` (before
     * the start) and the signed flow columns (in the period).
     */
    private function flows(int $branchId, CarbonInterface $start, CarbonInterface $end): Builder
    {
        // Two steps keep the per-row work small: the ledger rows are summed per (product, type),
        // streamed in the order of the covering index (no temporary table), as the part before
        // the start and the part up to the end; then those few groups are pivoted into the
        // columns. Left alone, MySQL prefers (branch_id, product_id, occurred_at) and looks up
        // every ledger row, which costs seconds over a year (performance test), so the covering
        // index is forced.
        $grouped = DB::table('stock_movements')
            ->forceIndex(self::MOVEMENTS_INDEX)
            ->where('branch_id', $branchId)
            ->where('occurred_at', '<', $end)
            ->select(['product_id', 'type'])
            ->selectRaw('SUM(CASE WHEN occurred_at < ? THEN qty_delta ELSE 0 END) AS before_qty', [$start])
            ->selectRaw('SUM(qty_delta) AS until_end_qty')
            ->groupBy('product_id', 'type');

        $query = DB::query()
            ->fromSub($grouped, 'ledger')
            ->groupBy('product_id')
            ->select('product_id')
            ->selectRaw('SUM(before_qty) AS opening_qty');

        foreach (self::FLOWS as $column => $flow) {
            $types = implode(', ', array_map(fn (string $type) => "'{$type}'", $flow['types']));
            $sign = $flow['sign'] < 0 ? '-' : '';

            $query->selectRaw("{$sign}SUM(CASE WHEN type IN ({$types}) THEN until_end_qty - before_qty ELSE 0 END) AS {$column}");
        }

        return $query;
    }

    /**
     * The matching products with their flows, current level and the flow totals over every
     * matching product (window sums, evaluated before the LIMIT).
     */
    private function rows(Builder $flows, int $branchId, ?int $categoryId, ?string $status): Builder
    {
        $query = DB::table('products')
            ->join('categories', 'categories.id', '=', 'products.category_id')
            ->leftJoinSub($flows, 'flows', 'flows.product_id', '=', 'products.id');

        $this->inventory->join($query, $branchId);

        $query
            ->where('products.track_stock', true)
            ->whereNull('products.deleted_at')
            ->when($categoryId !== null, fn (Builder $q) => $q->where('products.category_id', $categoryId))
            ->when($status !== null, fn (Builder $q) => $this->inventory->whereStatus($q, (string) $status))
            ->select(['products.id as product_id', 'products.name', 'categories.name as category_name', 'products.cost_cents'])
            ->selectRaw('CAST(COALESCE('.$this->inventory->col('flows.opening_qty').', 0) AS SIGNED) AS opening_qty')
            ->selectRaw('CAST(COALESCE('.$this->inventory->col(InventoryQuery::QTY).', 0) AS SIGNED) AS qty')
            ->addSelect(InventoryQuery::REORDER_LEVEL.' as reorder_level');

        foreach (array_keys(self::FLOWS) as $column) {
            $flow = $this->inventory->col("flows.{$column}");

            $query->selectRaw("CAST(COALESCE({$flow}, 0) AS SIGNED) AS {$column}")
                ->selectRaw("CAST(SUM(COALESCE({$flow}, 0)) OVER () AS SIGNED) AS total_{$column}");
        }

        return $query->orderBy('products.name')->orderBy('products.id');
    }
}
