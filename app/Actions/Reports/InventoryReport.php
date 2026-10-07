<?php

namespace App\Actions\Reports;

/**
 * A built inventory report (GET /api/v1/reports/inventory and its CSV export; Inventory, v1
 * completion).
 *
 * `totals`: `tracked`, `low`, `out`, `stock_value_cents` (the whole branch, now) and
 * `received`, `sold`, `returned`, `wasted`, `adjusted` (summed over every product matching
 * the filters in the period). Each row: `product_id`, `name`, `category_name`, `opening_qty`,
 * `received`, `sold`, `returned`, `wasted`, `adjusted`, `closing_qty` (the period), and
 * `reorder_level`, `status`, `unit_cost_cents`, `stock_value_cents` (now). `truncated`: more
 * than 500 rows existed.
 *
 * `kind` (Ingredients, Recipes & Purchasing): `products` (above) or `ingredients`, whose rows and
 * totals are BuildIngredientInventoryReportAction's.
 */
final class InventoryReport
{
    public const KIND_PRODUCTS = 'products';

    public const KIND_INGREDIENTS = 'ingredients';

    public const KINDS = [self::KIND_PRODUCTS, self::KIND_INGREDIENTS];

    /**
     * @param  array{tracked: int, low: int, out: int, stock_value_cents: int, received: int, sold: int, returned: int, wasted: int, adjusted: int}  $totals
     * @param  list<array{product_id: int, name: string, category_name: string, opening_qty: int, received: int, sold: int, returned: int, wasted: int, adjusted: int, closing_qty: int, reorder_level: int|null, status: string, unit_cost_cents: int, stock_value_cents: int}>  $rows
     */
    public function __construct(
        public readonly string $from,
        public readonly string $to,
        public readonly array $totals,
        public readonly array $rows,
        public readonly bool $truncated,
        public readonly string $kind = self::KIND_PRODUCTS,
    ) {}
}
