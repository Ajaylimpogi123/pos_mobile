<?php

namespace App\Http\Resources;

use App\Actions\Reports\PurchasingReport;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET /api/v1/reports/purchasing (Ingredients, Recipes & Purchasing → I): `data` = `{ from, to,
 * totals, rows }` and `meta` = `{ truncated }` (always present, as for the other reports). See
 * App\Actions\Reports\BuildPurchasingReportAction for the row and totals fields.
 *
 * @property-read PurchasingReport $resource
 */
class PurchasingReportResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var PurchasingReport $report */
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
        /** @var PurchasingReport $report */
        $report = $this->resource;

        return ['meta' => ['truncated' => $report->truncated]];
    }
}
