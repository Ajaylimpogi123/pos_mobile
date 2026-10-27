<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Tabs\CreateDiningTableAction;
use App\Actions\Tabs\DeleteDiningTableAction;
use App\Actions\Tabs\UpdateDiningTableAction;
use App\Actions\Tabs\UpdateTableLayoutAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Tables\ListDiningTablesRequest;
use App\Http\Requests\Admin\Tables\StoreDiningTableRequest;
use App\Http\Requests\Admin\Tables\UpdateDiningTableRequest;
use App\Http\Requests\Admin\Tables\UpdateTableLayoutRequest;
use App\Http\Resources\DiningTableResource;
use App\Models\DiningTable;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Admin management of the caller's branch dine-in tables (Dine-in Tables & Tabs → B;
 * permission `settings.manage`). `{diningTable}` resolves only within the caller's branch
 * (AppServiceProvider), so another branch's table, or a deleted one, is a 404. Not gated by
 * the dine-in setting, so tables can be set up first.
 */
class DiningTableController extends Controller
{
    /**
     * GET /api/v1/admin/tables
     *
     * The branch's non-deleted tables (inactive included), ordered by area, sort_order, name
     * (then id), cursor-paginated (default 100).
     */
    public function index(ListDiningTablesRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', DiningTable::class);

        $tables = DiningTable::query()
            ->where('branch_id', $this->actor($request)->branch_id)
            ->orderBy('area_sort')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return DiningTableResource::collection($tables);
    }

    /**
     * POST /api/v1/admin/tables
     */
    public function store(StoreDiningTableRequest $request, CreateDiningTableAction $create): JsonResponse
    {
        $this->authorize('create', DiningTable::class);

        $table = $create->execute($request->validated(), $this->actor($request), $request->ip());

        return (new DiningTableResource($table))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * PATCH /api/v1/admin/tables/{diningTable}
     */
    public function update(UpdateDiningTableRequest $request, DiningTable $diningTable, UpdateDiningTableAction $update): DiningTableResource
    {
        $this->authorize('update', $diningTable);

        return new DiningTableResource($update->execute($diningTable, $request->validated(), $this->actor($request), $request->ip()));
    }

    /**
     * PUT /api/v1/admin/tables/layout (Table Management → B)
     *
     * Saves one area's floor plan atomically; 200 with the area's tables in the admin order.
     */
    public function layout(UpdateTableLayoutRequest $request, UpdateTableLayoutAction $update): AnonymousResourceCollection
    {
        $this->authorize('updateLayout', DiningTable::class);

        return DiningTableResource::collection(
            $update->execute($this->actor($request), $request->area(), $request->entries(), $request->ip()),
        );
    }

    /**
     * DELETE /api/v1/admin/tables/{diningTable}
     */
    public function destroy(Request $request, DiningTable $diningTable, DeleteDiningTableAction $delete): Response
    {
        $this->authorize('delete', $diningTable);

        $delete->execute($diningTable, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
