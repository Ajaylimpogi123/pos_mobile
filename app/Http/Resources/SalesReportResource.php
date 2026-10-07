<?php

namespace App\Http\Resources;

use App\Actions\Reports\SalesReport;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET /api/v1/reports/sales (Phase 6): `data` = `{ from, to, group_by, totals, rows }` and
 * `meta` = `{ truncated }` (always present, Q-013).
 *
 * @property-read SalesReport $resource
 */
class SalesReportResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var SalesReport $report */
        $report = $this->resource;

        return [
            'from' => $report->from,
            'to' => $report->to,
            'group_by' => $report->groupBy,
            'totals' => $report->totals,
            'rows' => $report->rows,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function with(Request $request): array
    {
        /** @var SalesReport $report */
        $report = $this->resource;

        return ['meta' => ['truncated' => $report->truncated]];
    }
}
