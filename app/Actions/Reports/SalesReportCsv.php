<?php

namespace App\Actions\Reports;

use App\Support\Money;
use RuntimeException;

/**
 * The CSV export of a sales report (GET /api/v1/reports/sales/export, Phase 6): UTF-8 with
 * a BOM, CRLF line ends (RFC 4180), for spreadsheets. Provisional layout (Q-013):
 *
 * - header `key,label,orders_count,qty,gross_sales,discounts,net_sales,refunded_qty,refunds,
 *   net_after_refunds` (Phase 7 adds the last three); amounts in pesos with 2 decimals
 *   (`1250.50`), so the headers drop `_cents`;
 * - one line per report row (a `null` is an empty cell);
 * - a final `TOTAL` line from the report's totals; its `refunded_qty` is the units refunded
 *   in the range, whatever the grouping (as its `qty` is `items_sold`).
 */
class SalesReportCsv
{
    public const BOM = "\u{FEFF}";

    public const HEADER = ['key', 'label', 'orders_count', 'qty', 'gross_sales', 'discounts', 'net_sales', 'refunded_qty', 'refunds', 'net_after_refunds'];

    public static function filename(SalesReport $report): string
    {
        return sprintf('sales-%s-%s-%s.csv', $report->groupBy, $report->from, $report->to);
    }

    public function build(SalesReport $report): string
    {
        $handle = fopen('php://temp', 'r+') ?: throw new RuntimeException('Cannot open a temporary stream.');

        $this->line($handle, self::HEADER);

        foreach ($report->rows as $row) {
            $this->line($handle, [
                $row['key'],
                $row['label'],
                (string) $row['orders_count'],
                $row['qty'] === null ? '' : (string) $row['qty'],
                self::pesos($row['gross_sales_cents']),
                self::pesos($row['discounts_cents']),
                self::pesos($row['net_sales_cents']),
                $row['refunded_qty'] === null ? '' : (string) $row['refunded_qty'],
                self::pesos($row['refunds_cents']),
                self::pesos($row['net_after_refunds_cents']),
            ]);
        }

        $totals = $report->totals;

        $this->line($handle, [
            'TOTAL',
            '',
            (string) $totals['orders_count'],
            (string) $totals['items_sold'],
            self::pesos($totals['gross_sales_cents']),
            self::pesos($totals['discounts_cents']),
            self::pesos($totals['net_sales_cents']),
            (string) $report->refundedQty,
            self::pesos($totals['refunds_cents']),
            self::pesos($totals['net_after_refunds_cents']),
        ]);

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return self::BOM.$csv;
    }

    /**
     * @param  resource  $handle
     * @param  list<string>  $fields
     */
    private function line($handle, array $fields): void
    {
        fputcsv($handle, $fields, ',', '"', '', "\r\n");
    }

    private static function pesos(?int $cents): string
    {
        return $cents === null ? '' : Money::decimal($cents);
    }
}
