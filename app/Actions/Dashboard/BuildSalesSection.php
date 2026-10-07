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
 * The dashboard `sales` section (Phase 3): the caller's branch, today's business day, and
 * the sales, i.e. orders that are not `voided` (Phase 7; a refunded sale is still a sale).
 * Four aggregate queries, whatever the number of orders:
 *
 * 1. today's totals, with today's voids and refunds (Phase 7: `voids_count`,
 *    `refunds_cents` on the refund's own day, `net_after_refunds_cents`) in the same
 *    statement,
 * 2. today's payments by method (`amount_cents` is net of change),
 * 3. the last 7 business days (oldest first, 0-filled),
 * 4. today's top 5 products by qty, then net sales, then name; the name is the most
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

    /**
     * @return array<string, mixed>
     */
    public function execute(int $branchId, BusinessDay $businessDay, CarbonImmutable $now): array
    {
        $today = $businessDay->dateOf($now);

        $row = SalesFigures::totalsWithReversals(
            $this->orders($branchId)->where('orders.business_date', $today),
            SalesFigures::voidedOrders()->where('orders.branch_id', $branchId)->where('orders.business_date', $today),
            SalesFigures::refunds($branchId, $today, $today),
        )->first();

        $totals = SalesFigures::totalsFrom($row);
        $reversals = SalesFigures::reversalsFrom($row);

        $ordersCount = $totals['orders_count'];
        $netSales = $totals['net_sales_cents'];

        return [
            'business_date' => $today,
            'orders_count' => $ordersCount,
            'items_sold' => $totals['items_sold'],
            'gross_sales_cents' => $totals['gross_sales_cents'],
            'discounts_cents' => $totals['discounts_cents'],
            'net_sales_cents' => $netSales,
            'vat_amount_cents' => $totals['vat_amount_cents'],
            // SC/PWD: today's sales with SC/PWD, Σ R and Σ S (both part of `discounts_cents`).
            'sc_pwd_orders_count' => $totals['sc_pwd_orders_count'],
            'sc_pwd_vat_relief_cents' => $totals['sc_pwd_vat_relief_cents'],
            'sc_pwd_discount_cents' => $totals['sc_pwd_discount_cents'],
            'average_order_cents' => $ordersCount > 0 ? Money::roundHalfUp($netSales, $ordersCount) : 0,
            // Phase 7: today's voids (on the order's day) and refunds (on the refund's day).
            'voids_count' => $reversals['voids_count'],
            'refunds_cents' => $reversals['refunds_cents'],
            'net_after_refunds_cents' => $reversals['net_after_refunds_cents'],
            'by_payment_method' => SalesFigures::paymentMethodList(
                SalesFigures::paymentsByMethod($this->orders($branchId)->where('orders.business_date', $today))->get(),
            ),
            'last_7_days' => $this->lastDays($branchId, $businessDay, $now),
            'top_products' => $this->topProducts($branchId, $today),
        ];
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
     * Exactly 7 business days including today, oldest first, with 0-filled gaps.
     *
     * @return list<array{date: string, orders_count: int, net_sales_cents: int}>
     */
    private function lastDays(int $branchId, BusinessDay $businessDay, CarbonImmutable $now): array
    {
        $dates = array_column($businessDay->lastDays(self::DAYS, $now), 'date');

        $rows = $this->orders($branchId)
            ->whereBetween('orders.business_date', [$dates[0], $dates[self::DAYS - 1]])
            ->groupBy('orders.business_date')
            ->select('orders.business_date')
            ->selectRaw(SalesFigures::ORDERS_COUNT.' AS orders_count')
            ->selectRaw(SalesFigures::NET_SALES.' AS net_sales_cents')
            ->get()
            ->keyBy(fn (object $row) => substr((string) $row->business_date, 0, 10));

        return array_map(fn (string $date) => [
            'date' => $date,
            'orders_count' => (int) ($rows->get($date)?->orders_count ?? 0),
            'net_sales_cents' => (int) ($rows->get($date)?->net_sales_cents ?? 0),
        ], $dates);
    }

    /**
     * @return list<array{product_id: int, name: string, qty: int, net_sales_cents: int}>
     */
    private function topProducts(int $branchId, string $today): array
    {
        $perProduct = SalesFigures::saleLines($branchId, $today, $today)
            ->groupBy('order_items.product_id')
            ->select('order_items.product_id')
            ->selectRaw(SalesFigures::LINE_QTY.' AS qty')
            ->selectRaw(SalesFigures::LINE_NET_SALES.' AS net_sales_cents')
            ->selectRaw('MAX(order_items.id) AS last_item_id');

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
