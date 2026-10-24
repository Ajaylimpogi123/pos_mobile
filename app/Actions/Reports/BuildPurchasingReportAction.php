<?php

namespace App\Actions\Reports;

use App\Models\Branch;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\PurchaseRequestItem;
use App\Support\BusinessDay;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The purchasing report (Ingredients, Recipes & Purchasing → I): one row per purchase request
 * item of the branch whose PR was created in `from`..`to` (business days, branch timezone and day
 * start), with its PO line when there is one.
 *
 * **Filters:** `status` (the PR's), `decision`, `po_status`, `receiving_status` (a PO value —
 * `not_received`, `partially_received`, `fully_received` — filters the PO; a line value —
 * `pending`, `partial`, `complete`, `over_received` — filters the line), `supplier_id` (the line's
 * supplier, else the item's), `item_type` + `item_id`.
 *
 * **Row:** `pr_no`, `pr_date`, `requested_by`, `item_name`, `supplier_name`, `requested_qty`,
 * `unit` (the PR item's), `decision`, `decision_reason`, `decided_by`, `po_no`, `po_status`,
 * `ordered_qty`, `received_qty`, `remaining_qty` (in the PO line's unit), `line_receiving_status`,
 * `unit_price_cents`, `ordered_cents` (the line total), `received_cents` (Σ its receipt costs),
 * `last_received_at`. The PO fields are null for an item without a PO line. An ingredient's
 * quantities are strings with 3 decimals, a product's integers.
 *
 * **Totals** (every matching item, even when truncated): `prs`, `items`, `approved`, `declined`,
 * `pending`, `pos { pending_approval, approved, declined }` (distinct POs), and over the lines of
 * **approved** POs `ordered_cents`, `received_cents` and `remaining_cents`
 * (Σ max(ordered − received, 0) per line). Provisional, Q-030.
 *
 * **Queries** (set-based, two statements, no per-row queries). Both scan
 * `purchase_request_items_report_index` (`branch_id`, `requested_at` = the PR's `created_at`,
 * `purchase_request_id`, `id`, then the filter columns): a range scan in report order whose item
 * side is index-only. The PO line is read by its primary key (`purchase_order_line_id`), the PO
 * by its own, and the PR only for the `status` filter.
 *
 * - **Rows:** the ids of the first (≤ 501) matching rows, read in index order, so the scan stops
 *   after 501 matches without a sort; then the details and names of only those rows, by primary
 *   key.
 * - **Totals:** grouped per PR as the index streams (`GROUP BY requested_at,
 *   purchase_request_id`, no temporary table), then summed. A PR has at most one PO, so the PR
 *   groups count the POs without `COUNT(DISTINCT …)`.
 *
 * Rows are ordered by PR creation, PR and item id.
 */
class BuildPurchasingReportAction
{
    public const MAX_ROWS = 500;

    private const ITEM_INDEX = 'purchase_request_items_report_index';

    /**
     * @param  array{status?: string|null, decision?: string|null, po_status?: string|null, receiving_status?: string|null, supplier_id?: int|null, item_type?: string|null, item_id?: int|null}  $filters
     */
    public function execute(int $branchId, string $from, string $to, array $filters = []): PurchasingReport
    {
        $businessDay = BusinessDay::forBranch(Branch::withTrashed()->find($branchId));
        $start = $businessDay->range($from)['start']->utc()->toDateTimeString();
        $end = $businessDay->range($to)['end']->utc()->toDateTimeString();

        $records = $this->rows($this->pageIds($branchId, $start, $end, $filters));

        $dates = [];
        $rows = $records->take(self::MAX_ROWS)
            ->map(function (object $record) use ($businessDay, &$dates) {
                $created = (string) $record->pr_created_at;
                $dates[$created] ??= $businessDay->dateOf(CarbonImmutable::parse($created, 'UTC'));

                return $this->row($record, $dates[$created]);
            })
            ->values()
            ->all();

        return new PurchasingReport(
            from: $from,
            to: $to,
            totals: $this->totals($branchId, $start, $end, $filters),
            rows: $rows,
            truncated: $records->count() > self::MAX_ROWS,
        );
    }

    /**
     * The branch's PR items of the period in report order (the report index: `requested_at` is the
     * PR's `created_at`), with the PR `status` filter (the PR by primary key) and, when `$lines`,
     * their PO lines (and, when `$orders`, POs) by primary key, and the item-level filters.
     *
     * @param  array<string, mixed>  $filters
     */
    private function items(int $branchId, string $start, string $end, array $filters, bool $lines, bool $orders = true): Builder
    {
        $receivingStatus = $filters['receiving_status'] ?? null;
        $itemType = $filters['item_type'] ?? null;
        $itemId = $filters['item_id'] ?? null;
        $supplierId = $filters['supplier_id'] ?? null;

        $query = DB::table('purchase_request_items as pri')
            ->forceIndex(self::ITEM_INDEX)
            ->where('pri.branch_id', $branchId)
            ->where('pri.requested_at', '>=', $start)
            ->where('pri.requested_at', '<', $end);

        if (($filters['status'] ?? null) !== null) {
            $query->join('purchase_requests as pr', 'pr.id', '=', 'pri.purchase_request_id')->where('pr.status', $filters['status']);
        }

        if ($lines) {
            $query->leftJoin('purchase_order_lines as pol', 'pol.id', '=', 'pri.purchase_order_line_id');
        }

        if ($lines && $orders) {
            $query->leftJoin('purchase_orders as po', 'po.id', '=', 'pol.purchase_order_id');
        }

        return $query
            ->when(($filters['decision'] ?? null) !== null, fn (Builder $q) => $q->where('pri.decision', $filters['decision']))
            ->when(($filters['po_status'] ?? null) !== null, fn (Builder $q) => $q->where('po.status', $filters['po_status']))
            ->when($receivingStatus !== null, fn (Builder $q) => in_array($receivingStatus, PurchaseOrder::RECEIVING_STATUSES, true)
                ? $q->where('po.receiving_status', $receivingStatus)
                : $q->where('pol.receiving_status', $receivingStatus))
            ->when($supplierId !== null, fn (Builder $q) => $q->whereRaw($this->supplierOf().' = ?', [$supplierId]))
            ->when($itemType !== null && $itemId !== null, fn (Builder $q) => $q->where(
                $itemType === PurchaseRequestItem::ITEM_INGREDIENT ? 'pri.ingredient_id' : 'pri.product_id',
                $itemId,
            ));
    }

    /**
     * `pr_created_at`, `pr_id`, `item_id` of the first (≤ 501) matching rows, in report order.
     *
     * @param  array<string, mixed>  $filters
     */
    private function pageIds(int $branchId, string $start, string $end, array $filters): Builder
    {
        $needsLines = array_filter(
            array_intersect_key($filters, array_flip(['po_status', 'receiving_status', 'supplier_id'])),
            fn ($value) => $value !== null,
        ) !== [];

        // In index order, so the scan stops after 501 matches (no sort).
        return $this->items($branchId, $start, $end, $filters, lines: $needsLines)
            ->select(['pri.requested_at as pr_created_at', 'pri.purchase_request_id as pr_id', 'pri.id as item_id'])
            ->orderBy('pri.requested_at')
            ->orderBy('pri.purchase_request_id')
            ->orderBy('pri.id')
            ->limit(self::MAX_ROWS + 1);
    }

    /**
     * The page's rows with their details and names, by primary key, in report order.
     *
     * @return Collection<int, object>
     */
    private function rows(Builder $pageIds)
    {
        return DB::query()
            ->fromSub($pageIds, 'page')
            ->join('purchase_requests as pr', 'pr.id', '=', 'page.pr_id')
            ->join('purchase_request_items as pri', 'pri.id', '=', 'page.item_id')
            ->leftJoin('purchase_order_lines as pol', 'pol.id', '=', 'pri.purchase_order_line_id')
            ->leftJoin('purchase_orders as po', 'po.id', '=', 'pol.purchase_order_id')
            ->join('users as requester', 'requester.id', '=', 'pr.requested_by')
            ->leftJoin('users as decider', 'decider.id', '=', 'pri.decided_by')
            ->leftJoin('ingredients as ingredient', 'ingredient.id', '=', 'pri.ingredient_id')
            ->leftJoin('products as product', 'product.id', '=', 'pri.product_id')
            ->join('suppliers as supplier', 'supplier.id', '=', DB::raw($this->supplierOf()))
            ->select([
                'pr.pr_no', 'page.pr_created_at',
                'pri.ingredient_id', 'pri.qty as requested_qty', 'pri.unit', 'pri.decision', 'pri.decision_reason',
                'po.po_no', 'po.status as po_status',
                'pol.id as line_id', 'pol.qty as ordered_qty', 'pol.unit_factor', 'pol.received_base_qty',
                'pol.receiving_status as line_receiving_status', 'pol.unit_price_cents',
                'pol.line_total_cents as ordered_cents', 'pol.received_cents', 'pol.last_received_at',
            ])
            ->addSelect(['requester.name as requested_by_name', 'decider.name as decided_by_name'])
            ->selectRaw("COALESCE({$this->col('ingredient.name')}, {$this->col('product.name')}) AS item_name")
            ->addSelect('supplier.name as supplier_name')
            ->orderBy('page.pr_created_at')
            ->orderBy('page.pr_id')
            ->orderBy('page.item_id')
            ->get();
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    private function totals(int $branchId, string $start, string $end, array $filters): array
    {
        // A PR has at most one PO, and a matching item's PO (through its line) is its PR's PO. So
        // without a PO-level filter the PO is read once per PR group rather than once per item;
        // it counts only when some matching item of the PR has a line (`lines > 0`), as per item.
        $poFilter = ($filters['po_status'] ?? null) !== null
            || in_array($filters['receiving_status'] ?? null, PurchaseOrder::RECEIVING_STATUSES, true);

        $perRequest = $this->items($branchId, $start, $end, $filters, lines: true, orders: $poFilter)
            ->groupBy('pri.requested_at', 'pri.purchase_request_id')
            ->select('pri.purchase_request_id AS pr_id')
            ->selectRaw('COUNT(*) AS items')
            ->selectRaw("SUM({$this->col('pri.decision')} = 'approved') AS approved")
            ->selectRaw("SUM({$this->col('pri.decision')} = 'declined') AS declined")
            ->selectRaw($poFilter ? "MAX({$this->col('po.status')}) AS po_status" : "COUNT({$this->col('pol.id')}) AS line_count")
            ->selectRaw("SUM({$this->col('pol.line_total_cents')}) AS ordered")
            ->selectRaw("SUM({$this->col('pol.received_cents')}) AS received")
            ->selectRaw("SUM(GREATEST(CAST({$this->col('pol.line_total_cents')} AS SIGNED) - {$this->col('pol.received_cents')}, 0)) AS remaining");

        $query = DB::query()->fromSub($perRequest, 'g');

        if ($poFilter) {
            $status = $this->col('g.po_status');
        } else {
            $query->leftJoin('purchase_orders as po', 'po.purchase_request_id', '=', 'g.pr_id');
            $status = "(CASE WHEN {$this->col('g.line_count')} > 0 THEN {$this->col('po.status')} END)";
        }

        $approved = "{$status} = '".PurchaseOrder::STATUS_APPROVED."'";

        $row = $query
            ->selectRaw('COUNT(*) AS prs')
            ->selectRaw("COALESCE(SUM({$this->col('g.items')}), 0) AS items")
            ->selectRaw("COALESCE(SUM({$this->col('g.approved')}), 0) AS approved")
            ->selectRaw("COALESCE(SUM({$this->col('g.declined')}), 0) AS declined")
            ->selectRaw("COALESCE(SUM({$status} = 'pending_approval'), 0) AS pos_pending")
            ->selectRaw("COALESCE(SUM({$approved}), 0) AS pos_approved")
            ->selectRaw("COALESCE(SUM({$status} = 'declined'), 0) AS pos_declined")
            ->selectRaw("CAST(COALESCE(SUM(CASE WHEN {$approved} THEN {$this->col('g.ordered')} ELSE 0 END), 0) AS SIGNED) AS ordered_cents")
            ->selectRaw("CAST(COALESCE(SUM(CASE WHEN {$approved} THEN {$this->col('g.received')} ELSE 0 END), 0) AS SIGNED) AS received_cents")
            ->selectRaw("CAST(COALESCE(SUM(CASE WHEN {$approved} THEN {$this->col('g.remaining')} ELSE 0 END), 0) AS SIGNED) AS remaining_cents")
            ->first();

        $items = (int) ($row->items ?? 0);
        $approvedItems = (int) ($row->approved ?? 0);
        $declinedItems = (int) ($row->declined ?? 0);

        return [
            'prs' => (int) ($row->prs ?? 0),
            'items' => $items,
            'approved' => $approvedItems,
            'declined' => $declinedItems,
            'pending' => $items - $approvedItems - $declinedItems,
            'pos' => [
                'pending_approval' => (int) ($row->pos_pending ?? 0),
                'approved' => (int) ($row->pos_approved ?? 0),
                'declined' => (int) ($row->pos_declined ?? 0),
            ],
            'ordered_cents' => (int) ($row->ordered_cents ?? 0),
            'received_cents' => (int) ($row->received_cents ?? 0),
            'remaining_cents' => (int) ($row->remaining_cents ?? 0),
        ];
    }

    /**
     * The row's supplier: its PO line's, else the requested one.
     */
    private function supplierOf(): string
    {
        return "COALESCE({$this->col('pol.supplier_id')}, {$this->col('pri.supplier_id')})";
    }

    /**
     * A qualified column for a raw expression, wrapped by the query grammar so its table alias
     * gets the connection's table prefix, as the builder's own columns do.
     */
    private function col(string $column): string
    {
        return DB::getQueryGrammar()->wrap($column);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(object $record, string $prDate): array
    {
        $isIngredient = $record->ingredient_id !== null;
        $present = fn (BigDecimal|string $value): string|int => $isIngredient ? Quantity::format($value) : Quantity::round($value, 0)->toInt();
        $hasLine = $record->line_id !== null;

        $received = $hasLine ? PurchaseOrderLine::receivedQtyOf((string) $record->received_base_qty, (string) $record->unit_factor) : null;
        $remaining = $hasLine ? Quantity::max(BigDecimal::of((string) $record->ordered_qty)->minus($received), BigDecimal::zero()) : null;

        return [
            'pr_no' => (string) $record->pr_no,
            'pr_date' => $prDate,
            'requested_by' => (string) $record->requested_by_name,
            'item_name' => (string) $record->item_name,
            'supplier_name' => (string) $record->supplier_name,
            'requested_qty' => $present((string) $record->requested_qty),
            'unit' => (string) $record->unit,
            'decision' => (string) $record->decision,
            'decision_reason' => $record->decision_reason,
            'decided_by' => $record->decided_by_name,
            'po_no' => $record->po_no,
            'po_status' => $record->po_status,
            'ordered_qty' => $hasLine ? $present((string) $record->ordered_qty) : null,
            'received_qty' => $received === null ? null : $present($received),
            'remaining_qty' => $remaining === null ? null : $present($remaining),
            'line_receiving_status' => $record->line_receiving_status,
            'unit_price_cents' => $hasLine ? (int) $record->unit_price_cents : null,
            'ordered_cents' => $hasLine ? (int) $record->ordered_cents : null,
            'received_cents' => $hasLine ? (int) $record->received_cents : null,
            'last_received_at' => $record->last_received_at === null
                ? null
                : CarbonImmutable::parse((string) $record->last_received_at, 'UTC')->toIso8601ZuluString(),
        ];
    }
}
