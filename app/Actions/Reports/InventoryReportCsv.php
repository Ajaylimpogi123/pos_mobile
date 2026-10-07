<?php

namespace App\Actions\Reports;

use App\Support\Money;
use RuntimeException;

/**
 * The CSV export of the inventory report (GET /api/v1/reports/inventory/export; Inventory, v1
 * completion), with the Phase 6 conventions (SalesReportCsv): UTF-8 with a BOM, CRLF line
 * ends, pesos with 2 decimals (so the money headers drop `_cents`), a `null` as an empty cell.
 *
 * - header `product_id,name,category,opening_qty,received,sold,returned,wasted,adjusted,
 *   closing_qty,reorder_level,status,unit_cost,stock_value`;
 * - one line per report row (capped at 500 like the JSON);
 * - `TOTAL,,,,<received>,<sold>,<returned>,<wasted>,<adjusted>,,,,,<stock_value>` from the
 *   report's totals.
 */
class InventoryReportCsv
{
    public const HEADER = [
        'product_id', 'name', 'category', 'opening_qty', 'received', 'sold', 'returned', 'wasted', 'adjusted',
        'closing_qty', 'reorder_level', 'status', 'unit_cost', 'stock_value',
    ];

    /**
     * The ingredient kind (Ingredients, Recipes & Purchasing; provisional, Q-030): quantities in the
     * base unit, `avg_cost_cents` the rate in centavos per base unit (6 decimals), and the TOTAL
     * line `TOTAL,,,,,,,,,,,,,<stock_value>,<value_in>,<value_out>`.
     */
    public const INGREDIENT_HEADER = [
        'ingredient_id', 'name', 'base_unit', 'opening_qty', 'received', 'used', 'returned', 'wasted', 'adjusted',
        'closing_qty', 'reorder_level', 'status', 'avg_cost_cents', 'stock_value', 'value_in', 'value_out',
    ];

    /**
     * `inventory-<from>-<to>.csv`, and for ingredients `inventory-ingredients-<from>-<to>.csv`.
     */
    public static function filename(InventoryReport $report): string
    {
        return $report->kind === InventoryReport::KIND_INGREDIENTS
            ? sprintf('inventory-ingredients-%s-%s.csv', $report->from, $report->to)
            : sprintf('inventory-%s-%s.csv', $report->from, $report->to);
    }

    public function build(InventoryReport $report): string
    {
        if ($report->kind === InventoryReport::KIND_INGREDIENTS) {
            return $this->buildIngredients($report);
        }

        $handle = fopen('php://temp', 'r+') ?: throw new RuntimeException('Cannot open a temporary stream.');

        $this->line($handle, self::HEADER);

        foreach ($report->rows as $row) {
            $this->line($handle, [
                (string) $row['product_id'],
                $row['name'],
                $row['category_name'],
                (string) $row['opening_qty'],
                (string) $row['received'],
                (string) $row['sold'],
                (string) $row['returned'],
                (string) $row['wasted'],
                (string) $row['adjusted'],
                (string) $row['closing_qty'],
                $row['reorder_level'] === null ? '' : (string) $row['reorder_level'],
                $row['status'],
                Money::decimal($row['unit_cost_cents']),
                Money::decimal($row['stock_value_cents']),
            ]);
        }

        $totals = $report->totals;

        $this->line($handle, [
            'TOTAL', '', '', '',
            (string) $totals['received'],
            (string) $totals['sold'],
            (string) $totals['returned'],
            (string) $totals['wasted'],
            (string) $totals['adjusted'],
            '', '', '', '',
            Money::decimal($totals['stock_value_cents']),
        ]);

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return SalesReportCsv::BOM.$csv;
    }

    private function buildIngredients(InventoryReport $report): string
    {
        $handle = fopen('php://temp', 'r+') ?: throw new RuntimeException('Cannot open a temporary stream.');

        $this->line($handle, self::INGREDIENT_HEADER);

        foreach ($report->rows as $row) {
            $this->line($handle, [
                (string) $row['ingredient_id'],
                (string) $row['name'],
                (string) $row['base_unit'],
                (string) $row['opening_qty'],
                (string) $row['received'],
                (string) $row['used'],
                (string) $row['returned'],
                (string) $row['wasted'],
                (string) $row['adjusted'],
                (string) $row['closing_qty'],
                $row['reorder_level'] === null ? '' : (string) $row['reorder_level'],
                (string) $row['status'],
                (string) $row['avg_cost'],
                Money::decimal((int) $row['stock_value_cents']),
                Money::decimal((int) $row['value_in_cents']),
                Money::decimal((int) $row['value_out_cents']),
            ]);
        }

        $totals = $report->totals;

        $this->line($handle, [
            'TOTAL', '', '', '', '', '', '', '', '', '', '', '', '',
            Money::decimal((int) $totals['stock_value_cents']),
            Money::decimal((int) ($totals['value_in_cents'] ?? 0)),
            Money::decimal((int) ($totals['value_out_cents'] ?? 0)),
        ]);

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return SalesReportCsv::BOM.$csv;
    }

    /**
     * @param  resource  $handle
     * @param  list<string>  $fields
     */
    private function line($handle, array $fields): void
    {
        fputcsv($handle, $fields, ',', '"', '', "\r\n");
    }
}
