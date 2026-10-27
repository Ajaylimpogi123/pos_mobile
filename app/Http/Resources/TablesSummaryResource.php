<?php

namespace App\Http\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `TablesSummary` (GET /api/v1/tables/summary, Table Management → D), built by
 * App\Actions\Tables\BuildTablesSummary.
 *
 * @property array{
 *     tables_total: int, tables_occupied: int, tables_reserved: int, tables_free: int,
 *     guests_seated: int, pending_bills: int, pending_cents: int,
 *     oldest_open: array{tab_ulid: string, table_name: string, opened_at: CarbonInterface}|null,
 *     reservations_today: array{booked: int, seated: int, no_show: int, cancelled: int},
 *     generated_at: CarbonInterface
 * } $resource
 */
class TablesSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $summary = $this->resource;
        $oldest = $summary['oldest_open'];

        return [
            'tables_total' => $summary['tables_total'],
            'tables_occupied' => $summary['tables_occupied'],
            'tables_reserved' => $summary['tables_reserved'],
            'tables_free' => $summary['tables_free'],
            'guests_seated' => $summary['guests_seated'],
            'pending_bills' => $summary['pending_bills'],
            'pending_cents' => $summary['pending_cents'],
            'oldest_open' => $oldest === null ? null : [
                'tab_ulid' => $oldest['tab_ulid'],
                'table_name' => $oldest['table_name'],
                'opened_at' => $oldest['opened_at']->toIso8601ZuluString(),
            ],
            'reservations_today' => $summary['reservations_today'],
            'generated_at' => $summary['generated_at']->toIso8601ZuluString(),
        ];
    }
}
