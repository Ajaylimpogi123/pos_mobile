<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Sync\IngestOfflineOrdersAction;
use App\Actions\Sync\PullCatalogueAction;
use App\Actions\Sync\PullStockAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Sync\PullCatalogueRequest;
use App\Http\Requests\Sync\SyncOrdersRequest;
use App\Http\Resources\SyncCatalogueResource;
use App\Http\Resources\SyncOrderResultResource;
use App\Http\Resources\SyncStockResource;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Device sync. Phase 2: the catalogue pull (any authenticated user; the catalogue is
 * global reference data and never includes cost). Phase 5: pushing offline sales
 * (`sale.create`, from a registered device) and the advisory stock snapshot (any
 * authenticated user, the caller's branch).
 */
class SyncController extends Controller
{
    /**
     * GET /api/v1/sync/catalogue
     *
     * A full baseline without a cursor, otherwise a delta (changes and tombstones)
     * since the cursor. See PullCatalogueAction for the paging and restart rules.
     */
    public function catalogue(PullCatalogueRequest $request, PullCatalogueAction $pull): SyncCatalogueResource
    {
        return new SyncCatalogueResource($pull->execute($request->syncCursor(), $request->limit()));
    }

    /**
     * POST /api/v1/sync/orders
     *
     * 200 with one result per submitted order, in the same order (accepted / duplicate /
     * rejected). Only the envelope fails the whole request (401, 403, 409 without a
     * device, 422).
     */
    public function orders(SyncOrdersRequest $request, IngestOfflineOrdersAction $ingest): JsonResponse
    {
        $this->authorize('create', Order::class);

        /** @var User $caller */
        $caller = $request->user();

        $results = $ingest->execute($caller, $request->device(), $request->validated('orders'), $request->ip());

        return SyncOrderResultResource::collection($results)
            ->response()
            ->setStatusCode(200);
    }

    /**
     * GET /api/v1/sync/stock
     */
    public function stock(Request $request, PullStockAction $pull): SyncStockResource
    {
        /** @var User $caller */
        $caller = $request->user();

        return new SyncStockResource($pull->execute((int) $caller->branch_id));
    }
}
