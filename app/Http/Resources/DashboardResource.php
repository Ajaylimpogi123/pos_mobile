<?php

namespace App\Http\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's GET /api/v1/dashboard body (Phase 1c).
 *
 * Wraps the array built by App\Actions\Dashboard\BuildDashboardAction. Every key is
 * always present; a section the caller may not see is `null`. `sales` (Phase 3) needs
 * `report.view`.
 *
 * @property array<string, mixed> $resource
 */
class DashboardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var CarbonInterface $generatedAt */
        $generatedAt = $this->resource['generated_at'];

        return [
            'generated_at' => $generatedAt->toIso8601ZuluString(),
            'business_date' => $this->resource['business_date'],
            'catalog' => $this->resource['catalog'],
            'staff' => $this->resource['staff'],
            'customers' => $this->resource['customers'],
            'activity' => $this->resource['activity'],
            'sales' => $this->resource['sales'],
            'insights' => $this->resource['insights'],
        ];
    }
}
