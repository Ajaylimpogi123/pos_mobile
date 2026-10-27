<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Tabs\BuildTablesSummary;
use App\Http\Controllers\Controller;
use App\Http\Requests\Tabs\ListTablesRequest;
use App\Http\Requests\Tabs\TablesSummaryRequest;
use App\Http\Resources\TablesSummaryResource;
use App\Http\Resources\TableViewResource;
use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\Tab;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\BranchSettings;
use Carbon\CarbonImmutable;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The Tables view (Dine-in Tables & Tabs → C; `sale.create` or `report.view`) and the status
 * board summary (Table Management → D; `report.view`). Both are `409` while dine-in is off.
 */
class TableController extends Controller
{
    /**
     * GET /api/v1/tables
     *
     * The branch's active tables in the admin order (area, sort_order, name, then id), each
     * with its open tab summary (`null` when free) and its next reservation (the earliest
     * booked one whose slot hasn't ended, within the next 24 hours; `null` otherwise),
     * cursor-paginated (default 100).
     */
    public function index(ListTablesRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewTables', Tab::class);

        /** @var User $caller */
        $caller = $request->user();

        $tables = DiningTable::query()
            ->with(['openTab.opener', 'openTab.items'])
            ->where('branch_id', $caller->branch_id)
            ->where('is_active', true)
            ->orderBy('area_sort')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        $this->loadNextReservations($tables->getCollection()->all(), $caller);

        return TableViewResource::collection($tables);
    }

    /**
     * GET /api/v1/tables/summary
     */
    public function summary(TablesSummaryRequest $request, BuildTablesSummary $build): TablesSummaryResource
    {
        $this->authorize('viewSummary', Tab::class);

        /** @var User $caller */
        $caller = $request->user();

        return new TablesSummaryResource($build->execute(Branch::query()->findOrFail($caller->branch_id)));
    }

    /**
     * Sets each table's `nextReservation` relation (one query), with the branch's hold.
     *
     * @param  list<DiningTable>  $tables
     */
    private function loadNextReservations(array $tables, User $caller): void
    {
        $now = CarbonImmutable::now();
        $hold = BranchSettings::for(Branch::query()->findOrFail($caller->branch_id))->reservationHoldMinutes();

        $next = TableReservation::query()
            ->whereIn('table_id', array_map(fn (DiningTable $table) => $table->id, $tables))
            ->upcoming($now)
            ->where('reserved_for', '<=', $now->addDay())
            ->orderBy('reserved_for')
            ->orderBy('id')
            ->get()
            ->unique('table_id')
            ->keyBy('table_id');

        foreach ($tables as $table) {
            $table->setRelation('nextReservation', $next->get($table->id)?->withHoldMinutes($hold));
        }
    }
}
