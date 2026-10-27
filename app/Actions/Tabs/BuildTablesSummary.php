<?php

namespace App\Actions\Tabs;

use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\TableReservation;
use App\Support\BranchSettings;
use App\Support\BusinessDay;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The status board's figures (GET /api/v1/tables/summary, Table Management → D), over the
 * branch's **active** tables:
 *
 * - `tables_occupied`: tables with an open tab; `tables_reserved`: free tables held by a
 *   booked reservation; `tables_free`: the rest;
 * - `guests_seated`, `pending_bills` and `pending_cents` (Σ unit price × remaining qty, before
 *   discounts and service charge) over the open tabs;
 * - `oldest_open`: the open tab opened first (then the lowest id), or null;
 * - `reservations_today`: the branch's reservations of today's business day, by status.
 */
class BuildTablesSummary
{
    /**
     * @return array<string, mixed> The TablesSummaryResource shape
     */
    public function execute(Branch $branch): array
    {
        $now = CarbonImmutable::now();
        $hold = BranchSettings::for($branch)->reservationHoldMinutes();

        $tableIds = DiningTable::query()
            ->where('branch_id', $branch->id)
            ->where('is_active', true)
            ->pluck('id');

        $openTabs = Tab::query()
            ->with('table')
            ->where('branch_id', $branch->id)
            ->where('status', Tab::STATUS_OPEN)
            ->whereIn('open_table_id', $tableIds)
            ->orderBy('opened_at')
            ->orderBy('id')
            ->get(['id', 'ulid', 'table_id', 'open_table_id', 'guests', 'opened_at']);

        $occupiedIds = $openTabs->pluck('open_table_id');
        $freeIds = $tableIds->diff($occupiedIds)->values();

        $reserved = $freeIds->isEmpty() ? 0 : TableReservation::query()
            ->whereIn('table_id', $freeIds)
            ->held($hold, $now)
            ->distinct()
            ->count('table_id');

        $pendingCents = $openTabs->isEmpty() ? 0 : (int) TabItem::query()
            ->whereIn('tab_id', $openTabs->pluck('id'))
            ->sum(DB::raw('unit_price_cents * (qty - settled_qty - cancelled_qty)'));

        $byStatus = TableReservation::query()
            ->where('branch_id', $branch->id)
            ->where('business_date', BusinessDay::forBranch($branch)->dateOf($now))
            ->groupBy('status')
            ->selectRaw('status, COUNT(*) as aggregate')
            ->pluck('aggregate', 'status');

        /** @var Tab|null $oldest */
        $oldest = $openTabs->first();

        return [
            'tables_total' => $tableIds->count(),
            'tables_occupied' => $occupiedIds->count(),
            'tables_reserved' => $reserved,
            'tables_free' => $freeIds->count() - $reserved,
            'guests_seated' => (int) $openTabs->sum('guests'),
            'pending_bills' => $openTabs->count(),
            'pending_cents' => $pendingCents,
            'oldest_open' => $oldest === null ? null : [
                'tab_ulid' => $oldest->ulid,
                'table_name' => $oldest->table->name,
                'opened_at' => $oldest->opened_at,
            ],
            'reservations_today' => [
                'booked' => (int) ($byStatus[TableReservation::STATUS_BOOKED] ?? 0),
                'seated' => (int) ($byStatus[TableReservation::STATUS_SEATED] ?? 0),
                'no_show' => (int) ($byStatus[TableReservation::STATUS_NO_SHOW] ?? 0),
                'cancelled' => (int) ($byStatus[TableReservation::STATUS_CANCELLED] ?? 0),
            ],
            'generated_at' => $now,
        ];
    }
}
