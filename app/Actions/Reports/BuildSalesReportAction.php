<?php

namespace App\Actions\Reports;

use App\Models\Payment;
use App\Support\Sales\SalesFigures;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The sales report (Phase 6, with Phase 7's voids and refunds): the branch's sales (orders
 * that are not `voided`) whose business date falls in `from`..`to`, grouped by `day`,
 * `product`, `category`, `payment` or `cashier`, and the refunds made on the business days of
 * the range (their own day, not the sale's).
 *
 * Aggregated in SQL with **two set-based statements per report**, whatever the data size:
 * one for the totals (the sales, the voids and the refunds as derived tables of one SELECT)
 * and one for the grouped rows (capped in SQL). Each rows statement is a `UNION ALL` of the
 * sales groups and the refund groups, summed per group, so a group with refunds but no sales
 * in the range (e.g. a product refunded but not sold) still gets a row with sales of 0.
 * There are no per-row queries. Each part reads one table through its covering index
 * (`*_sales_report_index`: orders, order_items, payments, refunds, refund_items,
 * refund_payments), so a year of sales answers well under 500 ms. Two choices keep it there
 * (measured by the performance test): the order-level sales force the covering orders index
 * and select only the figures it carries; and the line and payment figures are every row of
 * the range minus the rows of the range's voided orders, rather than an anti-join probed
 * once per row. The range's lines and payments are grouped per business day and group as their
 * covering indexes stream (`order_items_product_report_index`, `…_category_report_index`,
 * `payments_sales_report_index`), with no sort of every row, then per group: an order's lines
 * and payments share its business date, so the per-day distinct order counts add up exactly.
 * Line discounts are Σ gross − Σ net, which is exact because every line's total is its gross
 * less its line discount, order share and SC/PWD relief and discount (SaleCalculator).
 * The figures use the shared definitions of App\Support\Sales\SalesFigures (the dashboard's):
 *
 * | group_by | rows (key / label) | sales figures | refunds | order |
 * |---|---|---|---|---|
 * | day | each business day of the range, 0-filled (the date / the date) | order level | on the refund's day | ascending |
 * | product | per `product_id` (id / latest line name snapshot) | line level | refund lines, with `refunded_qty` | net desc |
 * | category | per `category_id` snapshot (id / latest category name snapshot) | line level | refund lines, with `refunded_qty` | net desc |
 * | payment | cash, then gcash (the method / the method) | stored `amount_cents` (net of change); qty, gross and discounts null | refund payments by method | fixed |
 * | cashier | per user (id / the user's name) | order level | by the original sale's cashier | net desc |
 *
 * Every row has `refunds_cents` and `net_after_refunds_cents` = net − refunds; `refunded_qty`
 * is `null` except on product and category rows. Rows that tie on net sales are ordered by
 * label, then key (Q-013). At most 500 rows are returned; `truncated` says more existed.
 */
class BuildSalesReportAction
{
    public const GROUP_DAY = 'day';

    public const GROUP_PRODUCT = 'product';

    public const GROUP_CATEGORY = 'category';

    public const GROUP_PAYMENT = 'payment';

    public const GROUP_CASHIER = 'cashier';

    public const GROUPS = [self::GROUP_DAY, self::GROUP_PRODUCT, self::GROUP_CATEGORY, self::GROUP_PAYMENT, self::GROUP_CASHIER];

    public const MAX_ROWS = 500;

    /**
     * The covering index of the order-level report queries (Phase 6 migration).
     */
    private const ORDERS_INDEX = 'orders_sales_report_index';

    /**
     * The covering indexes of the product and category rows (business date, group, order, qty,
     * gross, net) and of the payment rows.
     */
    private const PRODUCT_LINES_INDEX = 'order_items_product_report_index';

    private const CATEGORY_LINES_INDEX = 'order_items_category_report_index';

    private const PAYMENTS_INDEX = 'payments_sales_report_index';

    /**
     * The summed columns of every rows statement, after `group_id` (and `last_item_id` for
     * the line groupings).
     */
    private const FIGURES = ['orders_count', 'qty', 'gross_sales_cents', 'discounts_cents', 'net_sales_cents', 'refunded_qty', 'refunds_cents'];

    public function execute(int $branchId, string $from, string $to, string $groupBy): SalesReport
    {
        $scope = fn (Builder $query): Builder => $query
            ->where('orders.branch_id', $branchId)
            ->whereBetween('orders.business_date', [$from, $to]);

        // The branch's sales in the range, read index-only. Left alone, MySQL prefers the
        // (branch_id, placed_at) index for a one-branch range and looks up every order row,
        // which costs several times more over a year (Phase 7 performance test).
        $sales = fn (): Builder => $scope(SalesFigures::sales()->forceIndex(self::ORDERS_INDEX));

        $totalsRow = SalesFigures::totalsWithReversals(
            $sales(),
            $scope(SalesFigures::voidedOrders()),
            SalesFigures::refunds($branchId, $from, $to),
            vatSplit: false,
        )
            ->crossJoinSub(
                SalesFigures::refundLines($branchId, $from, $to)->selectRaw(SalesFigures::REFUND_LINE_QTY.' AS refunded_qty'),
                'rq',
            )
            ->addSelect('rq.refunded_qty')
            ->first();

        $totals = SalesFigures::totalsFrom($totalsRow);

        $records = (match ($groupBy) {
            self::GROUP_DAY => $this->dayRows($sales, $branchId, $from, $to),
            self::GROUP_PRODUCT => $this->lineRows($branchId, $from, $to, 'product_id', 'product_name'),
            self::GROUP_CATEGORY => $this->lineRows($branchId, $from, $to, 'category_id', 'category_name'),
            self::GROUP_PAYMENT => $this->paymentRows($branchId, $from, $to),
            self::GROUP_CASHIER => $this->cashierRows($sales, $branchId, $from, $to),
        })->limit(self::MAX_ROWS + 1)->get();

        $rows = match ($groupBy) {
            self::GROUP_DAY => $this->fillDays($records, $from, $to),
            self::GROUP_PAYMENT => $this->fillPaymentMethods($records),
            default => $records->take(self::MAX_ROWS)->map(fn (object $record) => $this->row($record, $groupBy))->values()->all(),
        };

        return new SalesReport(
            from: $from,
            to: $to,
            groupBy: $groupBy,
            totals: [
                'orders_count' => $totals['orders_count'],
                'items_sold' => $totals['items_sold'],
                'gross_sales_cents' => $totals['gross_sales_cents'],
                'discounts_cents' => $totals['discounts_cents'],
                'net_sales_cents' => $totals['net_sales_cents'],
                'vat_amount_cents' => $totals['vat_amount_cents'],
                // SC/PWD (read from the covering index): sales with SC/PWD, Σ R and Σ S.
                'sc_pwd_orders_count' => $totals['sc_pwd_orders_count'],
                'sc_pwd_vat_relief_cents' => $totals['sc_pwd_vat_relief_cents'],
                'sc_pwd_discount_cents' => $totals['sc_pwd_discount_cents'],
                ...SalesFigures::reversalsFrom($totalsRow),
            ],
            rows: $rows,
            truncated: $records->count() > self::MAX_ROWS,
            refundedQty: (int) ($totalsRow->refunded_qty ?? 0),
        );
    }

    /**
     * Order-level sales per business day, plus the refunds made on that day, oldest first
     * (days without either are filled in afterwards).
     *
     * @param  callable(): Builder  $saleOrders  The branch's sales in the range (index-only)
     */
    private function dayRows(callable $saleOrders, int $branchId, string $from, string $to): Builder
    {
        $sales = $this->orderLevel(
            $saleOrders()->groupBy('orders.business_date'),
            'orders.business_date',
        );

        $refunds = $this->refundLevel(
            SalesFigures::refunds($branchId, $from, $to)->groupBy('refunds.business_date'),
            'refunds.business_date',
        );

        return $this->summed($sales, $refunds)
            ->selectRaw('CAST(u.group_id AS CHAR) AS row_key, CAST(u.group_id AS CHAR) AS label')
            ->orderBy('u.group_id');
    }

    /**
     * Order-level sales per cashier, plus the refunds of that cashier's sales (made in the
     * range, whatever the sale's day); the label is the user's name.
     *
     * @param  callable(): Builder  $saleOrders  The branch's sales in the range (index-only)
     */
    private function cashierRows(callable $saleOrders, int $branchId, string $from, string $to): Builder
    {
        $sales = $this->orderLevel(
            $saleOrders()->groupBy('orders.user_id'),
            'orders.user_id',
        );

        $refunds = $this->refundLevel(
            SalesFigures::refunds($branchId, $from, $to)
                ->join('orders', 'orders.id', '=', 'refunds.order_id')
                ->groupBy('orders.user_id'),
            'orders.user_id',
        );

        return $this->summed($sales, $refunds)
            ->join('users', 'users.id', '=', 'u.group_id')
            ->groupBy('users.name')
            ->selectRaw('CAST(u.group_id AS CHAR) AS row_key, users.name AS label')
            ->orderByDesc('net_sales_cents')
            ->orderBy('users.name')
            ->orderBy('u.group_id');
    }

    /**
     * Line-level sales per product or category snapshot, plus the refund lines of the range
     * (with `refunded_qty`); the label is the latest name snapshot of the group (its highest
     * order line id, sold or refunded).
     *
     * The sales' lines are every line of the range minus the lines of its voided orders
     * (a negated part): over a year that is much faster than excluding the voided orders
     * line by line, and exact, because voided orders and sales are disjoint (so even the
     * distinct `orders_count` subtracts). A group that nets to nothing (sold only on voided
     * orders, never refunded) is dropped.
     *
     * @param  'product_id'|'category_id'  $idColumn
     * @param  'product_name'|'category_name'  $nameColumn
     */
    private function lineRows(int $branchId, string $from, string $to, string $idColumn, string $nameColumn): Builder
    {
        // The range's lines per business day and group, as the group's own covering index
        // streams them (no sort of every line). An order's lines share its business date, so
        // the per-day distinct order counts add up exactly when summed per group below.
        $lines = SalesFigures::rangeLines($branchId, $from, $to)
            ->forceIndex($idColumn === 'product_id' ? self::PRODUCT_LINES_INDEX : self::CATEGORY_LINES_INDEX)
            ->groupBy('order_items.business_date', "order_items.{$idColumn}")
            ->select("order_items.{$idColumn} AS group_id")
            ->selectRaw('MAX(order_items.id) AS last_item_id');

        $voided = SalesFigures::voidedLines($branchId, $from, $to)
            ->groupBy("order_items.{$idColumn}")
            ->addSelect("order_items.{$idColumn} AS group_id")
            ->selectRaw('NULL AS last_item_id');

        // Discounts are derived at the end as gross − net: every line's
        // `line_total = gross − line discount − order share − SC/PWD relief − SC/PWD discount`
        // (SaleCalculator), so Σ discounts = Σ gross − Σ net exactly, without a per-line sum.
        foreach ([[$lines, ''], [$voided, '-']] as [$part, $sign]) {
            $part
                ->selectRaw($sign.SalesFigures::LINE_ORDERS_COUNT.' AS orders_count')
                ->selectRaw($sign.SalesFigures::LINE_QTY.' AS qty')
                ->selectRaw($sign.SalesFigures::LINE_GROSS_SALES.' AS gross_sales_cents')
                ->selectRaw('0 AS discounts_cents')
                ->selectRaw($sign.SalesFigures::LINE_NET_SALES.' AS net_sales_cents')
                ->selectRaw('0 AS refunded_qty, 0 AS refunds_cents');
        }

        // One row per group before the union (rather than one per day and group).
        $lines = DB::query()
            ->fromSub($lines, 'd')
            ->groupBy('d.group_id')
            ->select('d.group_id')
            ->selectRaw('MAX(d.last_item_id) AS last_item_id, SUM(d.orders_count) AS orders_count, SUM(d.qty) AS qty')
            ->selectRaw('SUM(d.gross_sales_cents) AS gross_sales_cents, 0 AS discounts_cents, SUM(d.net_sales_cents) AS net_sales_cents')
            ->selectRaw('0 AS refunded_qty, 0 AS refunds_cents');

        $refunds = SalesFigures::refundLines($branchId, $from, $to)
            ->groupBy("refund_items.{$idColumn}")
            ->select("refund_items.{$idColumn} AS group_id")
            ->selectRaw('MAX(refund_items.order_item_id) AS last_item_id')
            ->selectRaw('0 AS orders_count, 0 AS qty, 0 AS gross_sales_cents, 0 AS discounts_cents, 0 AS net_sales_cents')
            ->selectRaw(SalesFigures::REFUND_LINE_QTY.' AS refunded_qty')
            ->selectRaw(SalesFigures::REFUND_LINE_AMOUNT.' AS refunds_cents');

        $groups = $this->summed($lines, $voided, $refunds)
            ->selectRaw('MAX(u.last_item_id) AS last_item_id')
            ->havingRaw('SUM(u.orders_count) <> 0 OR SUM(u.refunded_qty) <> 0');

        return DB::query()
            ->fromSub($groups, 'g')
            ->join('order_items AS latest', 'latest.id', '=', 'g.last_item_id')
            ->selectRaw("CAST(g.group_id AS CHAR) AS row_key, latest.{$nameColumn} AS label")
            ->selectRaw('g.orders_count, g.qty, g.gross_sales_cents')
            ->selectRaw('g.gross_sales_cents - g.net_sales_cents AS discounts_cents')
            ->selectRaw('g.net_sales_cents, g.refunded_qty, g.refunds_cents')
            ->orderByDesc('g.net_sales_cents')
            ->orderBy("latest.{$nameColumn}")
            ->orderBy('g.group_id');
    }

    /**
     * Per payment method: the sales' payments (orders with a payment of that method, and Σ
     * the stored amount, net of change, as net sales), plus the money given back by the
     * range's refunds. No qty, gross or discounts. As for lines, the sales' payments are every
     * payment of the range minus those of its voided orders.
     */
    private function paymentRows(int $branchId, string $from, string $to): Builder
    {
        // Per business day and method as the covering payments index streams (no sort); an
        // order's payments share its business date, so the per-day distinct counts add up.
        $payments = SalesFigures::rangePayments($branchId, $from, $to)
            ->forceIndex(self::PAYMENTS_INDEX)
            ->groupBy('payments.business_date', 'payments.method')
            ->select('payments.method AS group_id');

        $voided = SalesFigures::voidedPayments($branchId, $from, $to)
            ->groupBy('payments.method')
            ->addSelect('payments.method AS group_id');

        foreach ([[$payments, ''], [$voided, '-']] as [$part, $sign]) {
            $part
                ->selectRaw($sign.SalesFigures::PAYMENT_ORDERS_COUNT.' AS orders_count')
                ->selectRaw('0 AS qty, 0 AS gross_sales_cents, 0 AS discounts_cents')
                ->selectRaw($sign.SalesFigures::PAYMENT_AMOUNT.' AS net_sales_cents')
                ->selectRaw('0 AS refunded_qty, 0 AS refunds_cents');
        }

        $refunds = SalesFigures::refundPayments($branchId, $from, $to)
            ->groupBy('refund_payments.method')
            ->select('refund_payments.method AS group_id')
            ->selectRaw('0 AS orders_count, 0 AS qty, 0 AS gross_sales_cents, 0 AS discounts_cents, 0 AS net_sales_cents, 0 AS refunded_qty')
            ->selectRaw(SalesFigures::REFUND_PAYMENT_AMOUNT.' AS refunds_cents');

        return $this->summed($payments, $voided, $refunds)
            ->selectRaw('u.group_id AS row_key, u.group_id AS label');
    }

    /**
     * Order-level sales figures grouped by `$groupExpression`, in the rows' column layout.
     */
    private function orderLevel(Builder $query, string $groupExpression): Builder
    {
        return $query
            ->selectRaw("{$groupExpression} AS group_id")
            ->selectRaw(SalesFigures::ORDERS_COUNT.' AS orders_count')
            ->selectRaw(SalesFigures::ITEMS_SOLD.' AS qty')
            ->selectRaw(SalesFigures::GROSS_SALES.' AS gross_sales_cents')
            ->selectRaw(SalesFigures::DISCOUNTS.' AS discounts_cents')
            ->selectRaw(SalesFigures::NET_SALES.' AS net_sales_cents')
            ->selectRaw('0 AS refunded_qty, 0 AS refunds_cents');
    }

    /**
     * Refunds (`refunds` rows) grouped by `$groupExpression`, in the rows' column layout.
     */
    private function refundLevel(Builder $query, string $groupExpression): Builder
    {
        return $query
            ->selectRaw("{$groupExpression} AS group_id")
            ->selectRaw('0 AS orders_count, 0 AS qty, 0 AS gross_sales_cents, 0 AS discounts_cents, 0 AS net_sales_cents, 0 AS refunded_qty')
            ->selectRaw(SalesFigures::REFUNDS_AMOUNT.' AS refunds_cents');
    }

    /**
     * `UNION ALL` of the parts (sales groups, negated voided groups, refund groups; same
     * columns), summed per `group_id` as `u`. The caller adds the key, the label and the order.
     */
    private function summed(Builder $first, Builder ...$others): Builder
    {
        foreach ($others as $other) {
            $first->unionAll($other);
        }

        $query = DB::query()
            ->fromSub($first, 'u')
            ->groupBy('u.group_id')
            ->addSelect('u.group_id');

        foreach (self::FIGURES as $figure) {
            $query->selectRaw("SUM(u.{$figure}) AS {$figure}");
        }

        return $query;
    }

    /**
     * @return array{key: string, label: string, orders_count: int, qty: int|null, gross_sales_cents: int|null, discounts_cents: int|null, net_sales_cents: int, refunded_qty: int|null, refunds_cents: int, net_after_refunds_cents: int}
     */
    private function row(object $record, string $groupBy): array
    {
        $isPayment = $groupBy === self::GROUP_PAYMENT;
        $isLine = in_array($groupBy, [self::GROUP_PRODUCT, self::GROUP_CATEGORY], true);
        $net = (int) $record->net_sales_cents;
        $refunds = (int) $record->refunds_cents;

        return [
            'key' => (string) $record->row_key,
            'label' => (string) $record->label,
            'orders_count' => (int) $record->orders_count,
            'qty' => $isPayment ? null : (int) $record->qty,
            'gross_sales_cents' => $isPayment ? null : (int) $record->gross_sales_cents,
            'discounts_cents' => $isPayment ? null : (int) $record->discounts_cents,
            'net_sales_cents' => $net,
            'refunded_qty' => $isLine ? (int) $record->refunded_qty : null,
            'refunds_cents' => $refunds,
            'net_after_refunds_cents' => $net - $refunds,
        ];
    }

    /**
     * One row per business day of the range, oldest first; days without sales or refunds
     * are 0.
     *
     * @param  Collection<int, object>  $records
     * @return list<array<string, mixed>>
     */
    private function fillDays(Collection $records, string $from, string $to): array
    {
        $byDate = $records->keyBy(fn (object $record) => (string) $record->row_key);
        $rows = [];

        for ($day = CarbonImmutable::parse($from); $day->toDateString() <= $to; $day = $day->addDay()) {
            $date = $day->toDateString();
            $record = $byDate->get($date);

            $rows[] = $record !== null ? $this->row($record, self::GROUP_DAY) : [
                'key' => $date,
                'label' => $date,
                'orders_count' => 0,
                'qty' => 0,
                'gross_sales_cents' => 0,
                'discounts_cents' => 0,
                'net_sales_cents' => 0,
                'refunded_qty' => null,
                'refunds_cents' => 0,
                'net_after_refunds_cents' => 0,
            ];
        }

        return $rows;
    }

    /**
     * Cash, then GCash, 0-filled.
     *
     * @param  Collection<int, object>  $records
     * @return list<array<string, mixed>>
     */
    private function fillPaymentMethods(Collection $records): array
    {
        $byMethod = $records->keyBy(fn (object $record) => (string) $record->row_key);

        return array_map(function (string $method) use ($byMethod) {
            $record = $byMethod->get($method);

            return $record !== null ? $this->row($record, self::GROUP_PAYMENT) : [
                'key' => $method,
                'label' => $method,
                'orders_count' => 0,
                'qty' => null,
                'gross_sales_cents' => null,
                'discounts_cents' => null,
                'net_sales_cents' => 0,
                'refunded_qty' => null,
                'refunds_cents' => 0,
                'net_after_refunds_cents' => 0,
            ];
        }, Payment::METHODS);
    }
}
