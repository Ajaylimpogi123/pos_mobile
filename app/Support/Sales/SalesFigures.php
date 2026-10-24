<?php

namespace App\Support\Sales;

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The one definition of the sales figures, aggregated in SQL and shared by the dashboard
 * `sales` section (Phase 3), the shift report (X-read / Z-read) and the sales reports
 * (Phase 6), so every screen counts a sale the same way:
 *
 * - **Sales** are the orders whose status is **not `voided`** (Phase 7): a refunded sale is
 *   still a sale, and its refunds are counted separately, on their own day and shift.
 * - **Order level** (sales(), scoped by the caller): `orders_count` = COUNT(*),
 *   `items_sold` = Σ items_qty (each order's Σ line qty), `gross_sales_cents` =
 *   Σ subtotal_cents, `discounts_cents` = Σ discount_cents, `net_sales_cents` =
 *   Σ total_cents, and the VAT split (Σ vatable_sales_cents, Σ vat_amount_cents,
 *   Σ vat_exempt_sales_cents). VAT is rounded per order, so it only exists at this level.
 *   SC/PWD: `sc_pwd_orders_count` = the sales with SC/PWD, `sc_pwd_vat_relief_cents` =
 *   Σ R and `sc_pwd_discount_cents` = Σ S (both already part of `discounts_cents`).
 * - **Line level** (saleLines(), or rangeLines() − voidedLines() over long ranges): per
 *   product or category, `orders_count` = the distinct
 *   orders, qty, gross, discounts = line discount + the line's share of the order discount
 *   + the line's SC/PWD `R_i + S_i`, and net = Σ line_total_cents. Summed over an order's lines these equal the order-level
 *   figures.
 * - **Payments** (paymentsByMethod(), rangePayments() − voidedPayments()): per method, `orders_count` = orders
 *   with at least one payment of that method, `amount_cents` = Σ the stored amount, which is
 *   net of change. Always both methods, cash first (paymentMethodList()).
 * - **Voids** (Phase 7, voidedOrders()): `voids_count` = COUNT(*), `voids_cents` =
 *   Σ total_cents of the voided orders, on the order's business day or in its shift.
 * - **Refunds** (Phase 7, refunds(), refundLines(), refundPayments()): counted on the
 *   **refund's** business day or shift: `refunds_count`, `refunds_cents` = Σ amount_cents,
 *   and `net_after_refunds_cents` = `net_sales_cents − refunds_cents`.
 *
 * Lines, payments, refund lines and refund payments carry their branch and business day
 * (Phase 6/7), so the range-scoped queries read one table through its covering index; the
 * order's `status` stays on `orders`, and voided orders are left out of the line and payment
 * figures by an anti-join.
 */
final class SalesFigures
{
    public const ORDERS_COUNT = 'COUNT(*)';

    /**
     * The SC/PWD figures of every sales total (ShiftReport, sales report `totals`, dashboard
     * `sales`), in their field order.
     */
    public const SC_PWD_FIGURES = ['sc_pwd_orders_count', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents'];

    public const VOIDS_COUNT = 'COUNT(*)';

    public const REFUNDS_COUNT = 'COUNT(*)';

    /*
     * The aggregate SQL expressions. They qualify their columns through the query grammar,
     * so the connection's table prefix is applied (a raw string is never prefixed).
     */

    public static function itemsSold(): string
    {
        return self::sum('orders.items_qty');
    }

    public static function grossSales(): string
    {
        return self::sum('orders.subtotal_cents');
    }

    public static function discounts(): string
    {
        return self::sum('orders.discount_cents');
    }

    public static function netSales(): string
    {
        return self::sum('orders.total_cents');
    }

    public static function vatableSales(): string
    {
        return self::sum('orders.vatable_sales_cents');
    }

    public static function vatAmount(): string
    {
        return self::sum('orders.vat_amount_cents');
    }

    public static function vatExemptSales(): string
    {
        return self::sum('orders.vat_exempt_sales_cents');
    }

    public static function scPwdOrdersCount(): string
    {
        return 'COALESCE(SUM('.self::column('orders.sc_pwd_mode').' IS NOT NULL), 0)';
    }

    public static function scPwdVatRelief(): string
    {
        return self::sum('orders.sc_pwd_vat_relief_cents');
    }

    public static function scPwdDiscount(): string
    {
        return self::sum('orders.sc_pwd_discount_cents');
    }

    /**
     * Dine-in Tables & Tabs → G: Σ the service charge `S` (already part of `total_cents`, so
     * of `net_sales_cents`; outside the line-based figures).
     */
    public static function serviceCharge(): string
    {
        return self::sum('orders.service_charge_cents');
    }

    public static function lineOrdersCount(): string
    {
        return 'COUNT(DISTINCT '.self::column('order_items.order_id').')';
    }

    public static function lineQty(): string
    {
        return self::sum('order_items.qty');
    }

    public static function lineGrossSales(): string
    {
        return self::sum('order_items.gross_cents');
    }

    public static function lineDiscounts(): string
    {
        return 'COALESCE(SUM('.self::column('order_items.line_discount_cents')
            .' + '.self::column('order_items.order_discount_share_cents')
            .' + '.self::column('order_items.sc_pwd_vat_relief_cents')
            .' + '.self::column('order_items.sc_pwd_discount_cents').'), 0)';
    }

    public static function lineNetSales(): string
    {
        return self::sum('order_items.line_total_cents');
    }

    public static function paymentOrdersCount(): string
    {
        return 'COUNT(DISTINCT '.self::column('payments.order_id').')';
    }

    public static function paymentAmount(): string
    {
        return self::sum('payments.amount_cents');
    }

    public static function voidsAmount(): string
    {
        return self::sum('orders.total_cents');
    }

    public static function refundsAmount(): string
    {
        return self::sum('refunds.amount_cents');
    }

    public static function refundLineQty(): string
    {
        return self::sum('refund_items.qty');
    }

    public static function refundLineAmount(): string
    {
        return self::sum('refund_items.amount_cents');
    }

    public static function refundPaymentAmount(): string
    {
        return self::sum('refund_payments.amount_cents');
    }

    /**
     * The sales: orders that are not voided (raw query builder, no select yet). The caller
     * adds the scope.
     */
    public static function sales(): Builder
    {
        return DB::table('orders')->where('orders.status', '!=', Order::STATUS_VOIDED);
    }

    /**
     * The voided orders (raw query builder, no select yet). The caller adds the scope.
     */
    public static function voidedOrders(): Builder
    {
        return DB::table('orders')->where('orders.status', Order::STATUS_VOIDED);
    }

    /**
     * The lines of the branch's sales on the business days `from`..`to` (raw query builder
     * on `order_items`, no select yet).
     */
    public static function saleLines(int $branchId, string $from, string $to): Builder
    {
        return DB::table('order_items')
            ->where('order_items.branch_id', $branchId)
            ->whereBetween('order_items.business_date', [$from, $to])
            ->whereNotIn('order_items.order_id', self::voidedOrderIds($branchId, $from, $to));
    }

    /**
     * Every line of the branch's orders on the business days `from`..`to`, voided ones
     * included (raw query builder on `order_items`, no select yet; index-only on
     * `order_items_sales_report_index`). Over a long range, `rangeLines() − voidedLines()`
     * gives the sales' line figures much faster than saleLines()'s anti-join, which probes
     * the voided ids once per line (the sales reports, Phase 7).
     */
    public static function rangeLines(int $branchId, string $from, string $to): Builder
    {
        return DB::table('order_items')
            ->where('order_items.branch_id', $branchId)
            ->whereBetween('order_items.business_date', [$from, $to]);
    }

    /**
     * The lines of the branch's voided orders on the business days `from`..`to` (raw query
     * builder on `orders` joined to `order_items`, no select yet). Always a short list.
     */
    public static function voidedLines(int $branchId, string $from, string $to): Builder
    {
        return self::voidedOrderIds($branchId, $from, $to)
            ->select([])
            ->join('order_items', 'order_items.order_id', '=', 'orders.id');
    }

    /**
     * Every payment of the branch's orders on the business days `from`..`to`, voided ones
     * included (see rangeLines()).
     */
    public static function rangePayments(int $branchId, string $from, string $to): Builder
    {
        return DB::table('payments')
            ->where('payments.branch_id', $branchId)
            ->whereBetween('payments.business_date', [$from, $to]);
    }

    /**
     * The payments of the branch's voided orders on the business days `from`..`to` (raw
     * query builder on `orders` joined to `payments`, no select yet).
     */
    public static function voidedPayments(int $branchId, string $from, string $to): Builder
    {
        return self::voidedOrderIds($branchId, $from, $to)
            ->select([])
            ->join('payments', 'payments.order_id', '=', 'orders.id');
    }

    /**
     * The branch's refunds on the business days `from`..`to` (the refund's own day; raw
     * query builder on `refunds`, no select yet).
     */
    public static function refunds(int $branchId, string $from, string $to): Builder
    {
        return DB::table('refunds')
            ->where('refunds.branch_id', $branchId)
            ->whereBetween('refunds.business_date', [$from, $to]);
    }

    /**
     * The lines of the branch's refunds on the business days `from`..`to` (raw query builder
     * on `refund_items`, no select yet).
     */
    public static function refundLines(int $branchId, string $from, string $to): Builder
    {
        return DB::table('refund_items')
            ->where('refund_items.branch_id', $branchId)
            ->whereBetween('refund_items.business_date', [$from, $to]);
    }

    /**
     * The money given back by the branch's refunds on the business days `from`..`to` (raw
     * query builder on `refund_payments`, no select yet).
     */
    public static function refundPayments(int $branchId, string $from, string $to): Builder
    {
        return DB::table('refund_payments')
            ->where('refund_payments.branch_id', $branchId)
            ->whereBetween('refund_payments.business_date', [$from, $to]);
    }

    /**
     * Adds every order-level total, aliased by its field name, to a query of sales.
     *
     * Without `$vatSplit`, `vatable_sales_cents` and `vat_exempt_sales_cents` are left out
     * (totalsFrom() reads them as 0), so a range query stays index-only on
     * `orders_sales_report_index`, which doesn't carry them (the sales reports only show
     * `vat_amount_cents`).
     */
    public static function selectTotals(Builder $orders, bool $vatSplit = true): Builder
    {
        $orders
            ->selectRaw(self::ORDERS_COUNT.' AS orders_count')
            ->selectRaw(self::itemsSold().' AS items_sold')
            ->selectRaw(self::grossSales().' AS gross_sales_cents')
            ->selectRaw(self::discounts().' AS discounts_cents')
            ->selectRaw(self::netSales().' AS net_sales_cents')
            ->selectRaw(self::vatAmount().' AS vat_amount_cents')
            ->selectRaw(self::scPwdOrdersCount().' AS sc_pwd_orders_count')
            ->selectRaw(self::scPwdVatRelief().' AS sc_pwd_vat_relief_cents')
            ->selectRaw(self::scPwdDiscount().' AS sc_pwd_discount_cents')
            ->selectRaw(self::serviceCharge().' AS service_charge_cents');

        if ($vatSplit) {
            $orders
                ->selectRaw(self::vatableSales().' AS vatable_sales_cents')
                ->selectRaw(self::vatExemptSales().' AS vat_exempt_sales_cents');
        }

        return $orders;
    }

    /**
     * Adds `voids_count` and `voids_cents` to a query of voided orders.
     */
    public static function selectVoids(Builder $voidedOrders): Builder
    {
        return $voidedOrders
            ->selectRaw(self::VOIDS_COUNT.' AS voids_count')
            ->selectRaw(self::voidsAmount().' AS voids_cents');
    }

    /**
     * Adds `refunds_count` and `refunds_cents` to a query of refunds.
     */
    public static function selectRefunds(Builder $refunds): Builder
    {
        return $refunds
            ->selectRaw(self::REFUNDS_COUNT.' AS refunds_count')
            ->selectRaw(self::refundsAmount().' AS refunds_cents');
    }

    /**
     * One row, in **one statement**: the order-level totals of the sales, plus the voids and
     * the refunds (each query scoped by the caller and without a select).
     */
    public static function totalsWithReversals(Builder $sales, Builder $voidedOrders, Builder $refunds, bool $vatSplit = true): Builder
    {
        return DB::query()
            ->fromSub(self::selectTotals($sales, $vatSplit), 's')
            ->crossJoinSub(self::selectVoids($voidedOrders), 'v')
            ->crossJoinSub(self::selectRefunds($refunds), 'r')
            ->select(['s.*', 'v.voids_count', 'v.voids_cents', 'r.refunds_count', 'r.refunds_cents']);
    }

    /**
     * A selectTotals() row as integers (every figure 0 when there is no row).
     *
     * @return array{orders_count: int, items_sold: int, gross_sales_cents: int, discounts_cents: int, net_sales_cents: int, vatable_sales_cents: int, vat_amount_cents: int, vat_exempt_sales_cents: int, sc_pwd_orders_count: int, sc_pwd_vat_relief_cents: int, sc_pwd_discount_cents: int, service_charge_cents: int}
     */
    public static function totalsFrom(?object $row): array
    {
        $figures = [];

        foreach (['orders_count', 'items_sold', 'gross_sales_cents', 'discounts_cents', 'net_sales_cents', 'vatable_sales_cents', 'vat_amount_cents', 'vat_exempt_sales_cents', ...self::SC_PWD_FIGURES, 'service_charge_cents'] as $key) {
            $figures[$key] = (int) ($row->{$key} ?? 0);
        }

        return $figures;
    }

    /**
     * The voids and refunds of a totalsWithReversals() row as integers (0 when there is no
     * row), with `net_after_refunds_cents` = net sales − refunds.
     *
     * @return array{voids_count: int, voids_cents: int, refunds_count: int, refunds_cents: int, net_after_refunds_cents: int}
     */
    public static function reversalsFrom(?object $row): array
    {
        $refunds = (int) ($row->refunds_cents ?? 0);

        return [
            'voids_count' => (int) ($row->voids_count ?? 0),
            'voids_cents' => (int) ($row->voids_cents ?? 0),
            'refunds_count' => (int) ($row->refunds_count ?? 0),
            'refunds_cents' => $refunds,
            'net_after_refunds_cents' => (int) ($row->net_sales_cents ?? 0) - $refunds,
        ];
    }

    /**
     * The payments of a query of sales, grouped by method (the caller may add more groups),
     * with `orders_count` and `amount_cents`.
     */
    public static function paymentsByMethod(Builder $orders): Builder
    {
        return $orders
            ->join('payments', 'payments.order_id', '=', 'orders.id')
            ->groupBy('payments.method')
            ->addSelect('payments.method')
            ->selectRaw(self::paymentOrdersCount().' AS orders_count')
            ->selectRaw(self::paymentAmount().' AS amount_cents');
    }

    /**
     * Always both methods, cash then GCash, 0-filled.
     *
     * @param  iterable<object>  $rows  Rows with `method`, `orders_count` and `amount_cents`
     * @return list<array{method: string, orders_count: int, amount_cents: int}>
     */
    public static function paymentMethodList(iterable $rows): array
    {
        $byMethod = [];

        foreach ($rows as $row) {
            $byMethod[$row->method] = $row;
        }

        return array_map(fn (string $method) => [
            'method' => $method,
            'orders_count' => (int) ($byMethod[$method]->orders_count ?? 0),
            'amount_cents' => (int) ($byMethod[$method]->amount_cents ?? 0),
        ], Payment::METHODS);
    }

    /**
     * Always both methods, cash then GCash, 0-filled, for the money given back by refunds.
     *
     * @param  iterable<object>  $rows  Rows with `method` and `amount_cents`
     * @return list<array{method: string, amount_cents: int}>
     */
    public static function refundMethodList(iterable $rows): array
    {
        $byMethod = [];

        foreach ($rows as $row) {
            $byMethod[$row->method] = $row;
        }

        return array_map(fn (string $method) => [
            'method' => $method,
            'amount_cents' => (int) ($byMethod[$method]->amount_cents ?? 0),
        ], Payment::METHODS);
    }

    /**
     * A qualified column, wrapped by the query grammar (so the table gets the connection prefix).
     */
    private static function column(string $column): string
    {
        return DB::getQueryGrammar()->wrap($column);
    }

    /**
     * `COALESCE(SUM(column), 0)` over a qualified column.
     */
    private static function sum(string $column): string
    {
        return 'COALESCE(SUM('.self::column($column).'), 0)';
    }

    /**
     * The ids of the branch's voided orders on those business days (always a short list).
     */
    private static function voidedOrderIds(int $branchId, string $from, string $to): Builder
    {
        return DB::table('orders')
            ->select('orders.id')
            ->where('orders.branch_id', $branchId)
            ->whereBetween('orders.business_date', [$from, $to])
            ->where('orders.status', Order::STATUS_VOIDED);
    }
}
