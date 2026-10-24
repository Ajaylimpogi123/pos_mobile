<?php

namespace App\Actions\Dashboard;

use App\Models\Order;
use App\Support\BusinessDay;
use App\Support\Money;
use App\Support\Sales\SalesFigures;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The dashboard `sales` section (Phase 3): the caller's branch and the sales, i.e. orders
 * that are not `voided` (Phase 7; a refunded sale is still a sale), over a period
 * (Dashboard Period Filter, v1.28: `day`, `month` or `year` anchored on a business date,
 * default today). Four or five aggregate queries, whatever the number of orders:
 *
 * 1. the period's totals, with its voids and refunds (Phase 7: `voids_count` on the
 *    order's business day, `refunds_cents` on the refund's own day,
 *    `net_after_refunds_cents`) in the same statement,
 * 2. the period's payments by method (`amount_cents` is net of change),
 * 3. the period's trend (day buckets, or month buckets for a year; oldest first, 0-filled),
 * 4. unless the period is Day / today (whose trend it is), the last 7 business days
 *    ending today (`last_7_days`, oldest first, 0-filled; kept for older builds),
 * 5. the period's top 5 products by qty, then net sales, then name; the name is the most
 *    recent line snapshot of the product.
 *
 * The figures use the shared definitions of App\Support\Sales\SalesFigures (Phase 6), the
 * same as the shift report and the sales reports. With no sales every figure is 0 and the
 * lists keep their fixed shapes.
 */
class BuildSalesSection
{
    public const DAYS = 7;

    public const TOP_PRODUCTS_LIMIT = 5;

    public const PERIOD_DAY = 'day';

    public const PERIOD_MONTH = 'month';

    public const PERIOD_YEAR = 'year';

    public const PERIODS = [self::PERIOD_DAY, self::PERIOD_MONTH, self::PERIOD_YEAR];

    /**
     * @param  string  $period  one of PERIODS
     * @param  string|null  $date  the anchor business date (`YYYY-MM-DD`, not after today); null = today
     * @return array<string, mixed>
     */
    public function execute(
        int $branchId,
        BusinessDay $businessDay,
        CarbonImmutable $now,
        string $period = self::PERIOD_DAY,
        ?string $date = null,
    ): array {
        $today = $businessDay->dateOf($now);
        $anchor = $date ?? $today;
        [$from, $to] = self::range($period, $anchor, $today);

        $row = SalesFigures::totalsWithReversals(
            $this->orders($branchId)->whereBetween('orders.business_date', [$from, $to]),
            SalesFigures::voidedOrders()->where('orders.branch_id', $branchId)->whereBetween('orders.business_date', [$from, $to]),
            SalesFigures::refunds($branchId, $from, $to),
        )->first();

        $totals = SalesFigures::totalsFrom($row);
        $reversals = SalesFigures::reversalsFrom($row);

        $ordersCount = $totals['orders_count'];
        $netSales = $totals['net_sales_cents'];

        $trend = $this->trend($branchId, $period, $anchor, $from, $to);

        // `last_7_days` is the Day trend anchored on today: reuse it when that is the period
        // (the default request), so it costs no extra query.
        $lastWeek = $period === self::PERIOD_DAY && $anchor === $today
            ? $trend['buckets']
            : $this->dayBuckets($branchId, array_column($businessDay->lastDays(self::DAYS, $now), 'date'));

        return [
            // v1.28: the period and its inclusive range; `business_date` stays today.
            'period' => $period,
            'date_from' => $from,
            'date_to' => $to,
            'business_date' => $today,
            'trend' => $trend,
            'orders_count' => $ordersCount,
            'items_sold' => $totals['items_sold'],
            'gross_sales_cents' => $totals['gross_sales_cents'],
            'discounts_cents' => $totals['discounts_cents'],
            'net_sales_cents' => $netSales,
            'vat_amount_cents' => $totals['vat_amount_cents'],
            // SC/PWD: the period's sales with SC/PWD, Σ R and Σ S (both part of `discounts_cents`).
            'sc_pwd_orders_count' => $totals['sc_pwd_orders_count'],
            'sc_pwd_vat_relief_cents' => $totals['sc_pwd_vat_relief_cents'],
            'sc_pwd_discount_cents' => $totals['sc_pwd_discount_cents'],
            // Dine-in: Σ the service charge (part of `net_sales_cents`).
            'service_charge_cents' => $totals['service_charge_cents'],
            'average_order_cents' => $ordersCount > 0 ? Money::roundHalfUp($netSales, $ordersCount) : 0,
            // Phase 7: the period's voids (on the order's day) and refunds (on the refund's day).
            'voids_count' => $reversals['voids_count'],
            'refunds_cents' => $reversals['refunds_cents'],
            'net_after_refunds_cents' => $reversals['net_after_refunds_cents'],
            'by_payment_method' => SalesFigures::paymentMethodList(
                SalesFigures::paymentsByMethod($this->orders($branchId)->whereBetween('orders.business_date', [$from, $to]))->get(),
            ),
            // Deprecated (v1.28): always the 7 business days ending today.
            'last_7_days' => array_map(
                fn (array $bucket) => [
                    'date' => $bucket['start'],
                    'orders_count' => $bucket['orders_count'],
                    'net_sales_cents' => $bucket['net_sales_cents'],
                ],
                $lastWeek,
            ),
            'top_products' => $this->topProducts($branchId, $from, $to),
        ];
    }

    /**
     * The inclusive business-date range of a period (v1.28 §B): `day` is the anchor; `month`
     * and `year` are the anchor's calendar month or year, ending today when it is the
     * current one. The anchor is never after today.
     *
     * @return array{0: string, 1: string}
     */
    public static function range(string $period, string $anchor, string $today): array
    {
        $date = CarbonImmutable::createFromFormat('!Y-m-d', $anchor);

        [$from, $to] = match ($period) {
            self::PERIOD_MONTH => [$date->startOfMonth()->toDateString(), $date->endOfMonth()->toDateString()],
            self::PERIOD_YEAR => [$date->startOfYear()->toDateString(), $date->endOfYear()->toDateString()],
            default => [$anchor, $anchor],
        };

        return [$from, min($to, $today)];
    }

    /**
     * The branch's orders flagged for review (Phase 5), for the `orders_need_review`
     * insight. Uses the (branch_id, needs_review) index.
     */
    public function countNeedingReview(int $branchId): int
    {
        return Order::query()
            ->where('branch_id', $branchId)
            ->where('needs_review', true)
            ->count();
    }

    /**
     * The period's chart (v1.28 §C): `day`, the 7 business days ending on the anchor;
     * `month`, each day of the range; `year`, each month from January to the range's last
     * month.
     *
     * @return array{unit: string, buckets: list<array{start: string, orders_count: int, net_sales_cents: int}>}
     */
    private function trend(int $branchId, string $period, string $anchor, string $from, string $to): array
    {
        if ($period === self::PERIOD_YEAR) {
            return ['unit' => 'month', 'buckets' => $this->monthBuckets($branchId, $from, $to)];
        }

        [$first, $last] = $period === self::PERIOD_DAY
            ? [CarbonImmutable::createFromFormat('!Y-m-d', $anchor)->subDays(self::DAYS - 1)->toDateString(), $anchor]
            : [$from, $to];

        $dates = [];
        for ($day = CarbonImmutable::createFromFormat('!Y-m-d', $first); $day->toDateString() <= $last; $day = $day->addDay()) {
            $dates[] = $day->toDateString();
        }

        return ['unit' => 'day', 'buckets' => $this->dayBuckets($branchId, $dates)];
    }

    /**
     * One bucket per given business date (consecutive, oldest first), 0-filled.
     *
     * @param  list<string>  $dates
     * @return list<array{start: string, orders_count: int, net_sales_cents: int}>
     */
    private function dayBuckets(int $branchId, array $dates): array
    {
        $rows = $this->orders($branchId)
            ->whereBetween('orders.business_date', [$dates[0], $dates[count($dates) - 1]])
            ->groupBy('orders.business_date')
            ->select('orders.business_date')
            ->selectRaw(SalesFigures::ORDERS_COUNT.' AS orders_count')
            ->selectRaw(SalesFigures::netSales().' AS net_sales_cents')
            ->get()
            ->keyBy(fn (object $row) => substr((string) $row->business_date, 0, 10));

        return array_map(fn (string $date) => [
            'start' => $date,
            'orders_count' => (int) ($rows->get($date)?->orders_count ?? 0),
            'net_sales_cents' => (int) ($rows->get($date)?->net_sales_cents ?? 0),
        ], $dates);
    }

    /**
     * One bucket per calendar month of business dates from `from`'s month to `to`'s month,
     * `start` = the 1st, 0-filled. Groups by YEAR/MONTH of `business_date` on the
     * (branch_id, business_date) index.
     *
     * @return list<array{start: string, orders_count: int, net_sales_cents: int}>
     */
    private function monthBuckets(int $branchId, string $from, string $to): array
    {
        // Raw expressions: wrap the column so the connection's table prefix applies.
        $date = DB::getQueryGrammar()->wrap('orders.business_date');

        $rows = $this->orders($branchId)
            ->whereBetween('orders.business_date', [$from, $to])
            ->groupByRaw("YEAR({$date}), MONTH({$date})")
            ->selectRaw("YEAR({$date}) AS y, MONTH({$date}) AS m")
            ->selectRaw(SalesFigures::ORDERS_COUNT.' AS orders_count')
            ->selectRaw(SalesFigures::netSales().' AS net_sales_cents')
            ->get()
            ->keyBy(fn (object $row) => sprintf('%04d-%02d-01', (int) $row->y, (int) $row->m));

        $buckets = [];
        $last = CarbonImmutable::createFromFormat('!Y-m-d', $to)->startOfMonth();

        for ($month = CarbonImmutable::createFromFormat('!Y-m-d', $from)->startOfMonth(); $month <= $last; $month = $month->addMonth()) {
            $start = $month->toDateString();
            $buckets[] = [
                'start' => $start,
                'orders_count' => (int) ($rows->get($start)?->orders_count ?? 0),
                'net_sales_cents' => (int) ($rows->get($start)?->net_sales_cents ?? 0),
            ];
        }

        return $buckets;
    }

    /**
     * @return list<array{product_id: int, name: string, qty: int, net_sales_cents: int}>
     */
    private function topProducts(int $branchId, string $from, string $to): array
    {
        $perProduct = SalesFigures::saleLines($branchId, $from, $to)
            ->groupBy('order_items.product_id')
            ->select('order_items.product_id')
            ->selectRaw(SalesFigures::lineQty().' AS qty')
            ->selectRaw(SalesFigures::lineNetSales().' AS net_sales_cents')
            ->selectRaw('MAX(id) AS last_item_id');

        return DB::query()
            ->fromSub($perProduct, 'p')
            ->join('order_items AS latest', 'latest.id', '=', 'p.last_item_id')
            ->select(['p.product_id', 'latest.product_name AS name', 'p.qty', 'p.net_sales_cents'])
            ->orderByDesc('p.qty')
            ->orderByDesc('p.net_sales_cents')
            ->orderBy('latest.product_name')
            ->orderBy('p.product_id')
            ->limit(self::TOP_PRODUCTS_LIMIT)
            ->get()
            ->map(fn (object $row) => [
                'product_id' => (int) $row->product_id,
                'name' => $row->name,
                'qty' => (int) $row->qty,
                'net_sales_cents' => (int) $row->net_sales_cents,
            ])
            ->all();
    }

    /**
     * The branch's sales, i.e. orders that are not voided (raw query builder, no select yet).
     */
    private function orders(int $branchId): Builder
    {
        return SalesFigures::sales()->where('orders.branch_id', $branchId);
    }
}
