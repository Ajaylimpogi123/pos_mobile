<?php

namespace App\Actions\Dashboard;

use App\Models\Customer;
use Carbon\CarbonImmutable;

/**
 * The dashboard `customers` section (global; soft-deleted excluded). One query.
 * The windows are rolling: `created_at` within the last 7 / 30 days before `$now`.
 */
class BuildCustomersSection
{
    /**
     * @return array{total: int, new_last_7_days: int, new_last_30_days: int}
     */
    public function execute(CarbonImmutable $now): array
    {
        $now = $now->utc();

        $row = Customer::query()
            ->toBase()
            ->selectRaw('COUNT(*) AS total')
            ->selectRaw('SUM(created_at >= ?) AS last_7', [$now->subDays(7)->toDateTimeString()])
            ->selectRaw('SUM(created_at >= ?) AS last_30', [$now->subDays(30)->toDateTimeString()])
            ->first();

        return [
            'total' => (int) $row->total,
            'new_last_7_days' => (int) $row->last_7,
            'new_last_30_days' => (int) $row->last_30,
        ];
    }
}
