<?php

namespace App\Actions\Reports;

/**
 * A built purchasing report (GET /api/v1/reports/purchasing and its CSV export; Ingredients,
 * Recipes & Purchasing → I): one row per PR item, the totals over every matching item (even when
 * the rows are truncated), and `truncated` (more than 500 rows existed).
 */
final class PurchasingReport
{
    /**
     * @param  array<string, mixed>  $totals
     * @param  list<array<string, mixed>>  $rows
     */
    public function __construct(
        public readonly string $from,
        public readonly string $to,
        public readonly array $totals,
        public readonly array $rows,
        public readonly bool $truncated,
    ) {}
}
