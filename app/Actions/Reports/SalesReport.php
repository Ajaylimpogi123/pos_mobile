<?php

namespace App\Actions\Reports;

/**
 * A built sales report (GET /api/v1/reports/sales and its CSV export, Phase 6; Phase 7 adds
 * the voids and refunds).
 *
 * `totals`: `orders_count`, `items_sold`, `gross_sales_cents`, `discounts_cents`,
 * `net_sales_cents`, `vat_amount_cents`, `sc_pwd_orders_count`, `sc_pwd_vat_relief_cents`,
 * `sc_pwd_discount_cents` (SC/PWD), `service_charge_cents` (Dine-in), `voids_count`, `voids_cents`, `refunds_count`,
 * `refunds_cents`, `net_after_refunds_cents`. Each row: `key`, `label`, `orders_count`,
 * `qty`, `gross_sales_cents`, `discounts_cents`, `net_sales_cents`, `refunded_qty`,
 * `refunds_cents`, `net_after_refunds_cents` (`qty`, gross and discounts are null for payment
 * rows; `refunded_qty` is null except for product and category rows). `truncated`: more
 * than 500 rows existed. `refundedQty`: the units refunded in the range, for the CSV's
 * `TOTAL` line only (it isn't a JSON field).
 */
final class SalesReport
{
    /**
     * @param  array{orders_count: int, items_sold: int, gross_sales_cents: int, discounts_cents: int, net_sales_cents: int, vat_amount_cents: int, sc_pwd_orders_count: int, sc_pwd_vat_relief_cents: int, sc_pwd_discount_cents: int, service_charge_cents: int, voids_count: int, voids_cents: int, refunds_count: int, refunds_cents: int, net_after_refunds_cents: int}  $totals
     * @param  list<array{key: string, label: string, orders_count: int, qty: int|null, gross_sales_cents: int|null, discounts_cents: int|null, net_sales_cents: int, refunded_qty: int|null, refunds_cents: int, net_after_refunds_cents: int}>  $rows
     */
    public function __construct(
        public readonly string $from,
        public readonly string $to,
        public readonly string $groupBy,
        public readonly array $totals,
        public readonly array $rows,
        public readonly bool $truncated,
        public readonly int $refundedQty = 0,
    ) {}
}
