<?php

namespace App\Http\Resources;

use App\Actions\Reports\InventoryReport;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET /api/v1/reports/inventory (Inventory, v1 completion): `data` = `{ from, to, totals,
 * rows }` and `meta` = `{ truncated }` (always present, as for the sales reports).
 *
 * @property-read InventoryReport $resource
 */
class InventoryReportResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var InventoryReport $report */
        $report = $this->resource;

        return [
            'from' => $report->from,
            'to' => $report->to,
            'totals' => $report->totals,
            'rows' => $report->rows,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function with(Request $request): array
    {
        /** @var InventoryReport $report */
        $report = $this->resource;

        return ['meta' => ['truncated' => $report->truncated]];
    }
}
