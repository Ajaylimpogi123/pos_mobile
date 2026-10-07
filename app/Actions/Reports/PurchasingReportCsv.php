<?php

namespace App\Actions\Reports;

use App\Support\Money;
use RuntimeException;

/**
 * The CSV export of the purchasing report (GET /api/v1/reports/purchasing/export; Ingredients,
 * Recipes & Purchasing → I), with the Phase 6 conventions (SalesReportCsv): UTF-8 with a BOM, CRLF
 * line ends, pesos with 2 decimals (so the money headers drop `_cents`), a `null` as an empty cell.
 *
 * - the header is the row fields in order (`unit_price`, `ordered`, `received` for the money);
 * - one line per report row (capped at 500 like the JSON);
 * - `TOTAL,<prs>,,,,<items>,,,,,,,,,,,,<ordered>,<received>,` from the totals: the PR and item
 *   counts under `pr_date` and `requested_qty`, the approved POs' amounts under `ordered` and
 *   `received` (provisional layout, Q-030).
 */
class PurchasingReportCsv
{
    public const HEADER = [
        'pr_no', 'pr_date', 'requested_by', 'item_name', 'supplier_name', 'requested_qty', 'unit',
        'decision', 'decision_reason', 'decided_by', 'po_no', 'po_status', 'ordered_qty', 'received_qty',
        'remaining_qty', 'line_receiving_status', 'unit_price', 'ordered', 'received', 'last_received_at',
    ];

    public static function filename(PurchasingReport $report): string
    {
        return sprintf('purchasing-%s-%s.csv', $report->from, $report->to);
    }

    public function build(PurchasingReport $report): string
    {
        $handle = fopen('php://temp', 'r+') ?: throw new RuntimeException('Cannot open a temporary stream.');

        $this->line($handle, self::HEADER);

        $cell = fn (mixed $value): string => $value === null ? '' : (string) $value;
        $money = fn (?int $cents): string => $cents === null ? '' : Money::decimal($cents);

        foreach ($report->rows as $row) {
            $this->line($handle, [
                $row['pr_no'], $row['pr_date'], $row['requested_by'], $row['item_name'], $row['supplier_name'],
                $cell($row['requested_qty']), $row['unit'], $row['decision'], $cell($row['decision_reason']),
                $cell($row['decided_by']), $cell($row['po_no']), $cell($row['po_status']),
                $cell($row['ordered_qty']), $cell($row['received_qty']), $cell($row['remaining_qty']),
                $cell($row['line_receiving_status']),
                $money($row['unit_price_cents']), $money($row['ordered_cents']), $money($row['received_cents']),
                $cell($row['last_received_at']),
            ]);
        }

        $totals = $report->totals;

        $this->line($handle, [
            'TOTAL', (string) $totals['prs'], '', '', '', (string) $totals['items'],
            '', '', '', '', '', '', '', '', '', '', '',
            Money::decimal((int) $totals['ordered_cents']),
            Money::decimal((int) $totals['received_cents']),
            '',
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
