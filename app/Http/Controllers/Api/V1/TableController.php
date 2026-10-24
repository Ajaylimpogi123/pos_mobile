<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tabs\ListTablesRequest;
use App\Http\Resources\TableViewResource;
use App\Models\DiningTable;
use App\Models\Tab;
use App\Models\User;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The Tables view (Dine-in Tables & Tabs → C; `sale.create`; `409` while dine-in is off).
 */
class TableController extends Controller
{
    /**
     * GET /api/v1/tables
     *
     * The branch's active tables in the admin order (area, sort_order, name, then id), each
     * with its open tab summary (`null` when free), cursor-paginated (default 100).
     */
    public function index(ListTablesRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Tab::class);

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

        return TableViewResource::collection($tables);
    }
}
