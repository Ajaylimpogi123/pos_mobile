<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Purchasing\CreatePurchaseRequestAction;
use App\Actions\Purchasing\DecidePurchaseRequestAction;
use App\Actions\Purchasing\UpdatePurchaseRequestAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Purchasing\CancelPurchaseRequestRequest;
use App\Http\Requests\Purchasing\DecidePurchaseRequestRequest;
use App\Http\Requests\Purchasing\ListPurchaseRequestsRequest;
use App\Http\Requests\Purchasing\StorePurchaseRequestRequest;
use App\Http\Requests\Purchasing\UpdatePurchaseRequestRequest;
use App\Http\Resources\PurchaseRequestResource;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Purchase requests of the caller's branch (Ingredients, Recipes & Purchasing → F). Another
 * branch's PR is a 404 (the `{purchaseRequest}` binding, AppServiceProvider). Permissions:
 * PurchaseRequestPolicy.
 */
class PurchaseRequestController extends Controller
{
    /**
     * GET /api/v1/purchase-requests: newest first.
     */
    public function index(ListPurchaseRequestsRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', PurchaseRequest::class);

        $actor = $this->actor($request);
        $status = $request->validated('status');
        $supplierId = $request->integerFilter('supplier_id');
        $search = $request->search();
        $mine = $request->booleanFilter('mine');
        $needsDecision = $request->booleanFilter('needs_decision');

        $requests = PurchaseRequest::query()
            ->where('branch_id', $actor->branch_id)
            ->with(PurchaseRequest::resourceRelations())
            ->when($status !== null, fn (Builder $query) => $query->where('status', $status))
            ->when($supplierId !== null, fn (Builder $query) => $query->whereHas('items', fn (Builder $q) => $q->where('supplier_id', $supplierId)))
            ->when($search !== null, function (Builder $query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn (Builder $q) => $q->where('pr_no', 'like', $term)
                    ->orWhereHas('items', fn (Builder $items) => $items
                        ->whereHas('ingredient', fn (Builder $i) => $i->where('name', 'like', $term))
                        ->orWhereHas('product', fn (Builder $p) => $p->where('name', 'like', $term))));
            })
            ->when($mine !== null, fn (Builder $query) => $mine
                ? $query->where('requested_by', $actor->id)
                : $query->where('requested_by', '!=', $actor->id))
            ->when($needsDecision === true, fn (Builder $query) => $this->needingDecisionBy($query, $actor))
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return PurchaseRequestResource::collection($requests);
    }

    /**
     * POST /api/v1/purchase-requests
     */
    public function store(StorePurchaseRequestRequest $request, CreatePurchaseRequestAction $create): JsonResponse
    {
        $this->authorize('create', PurchaseRequest::class);

        $purchaseRequest = $create->execute(
            actor: $this->actor($request),
            ulid: (string) $request->validated('ulid'),
            dateNeeded: $request->dateNeeded(),
            remarks: $request->remarks(),
            items: $request->items(),
            ip: $request->ip(),
        );

        return $this->resource($purchaseRequest)->response()->setStatusCode(201);
    }

    /**
     * GET /api/v1/purchase-requests/{purchaseRequest}
     */
    public function show(PurchaseRequest $purchaseRequest): PurchaseRequestResource
    {
        $this->authorize('view', $purchaseRequest);

        return $this->resource($purchaseRequest);
    }

    /**
     * PATCH /api/v1/purchase-requests/{purchaseRequest}
     */
    public function update(UpdatePurchaseRequestRequest $request, PurchaseRequest $purchaseRequest, UpdatePurchaseRequestAction $update): PurchaseRequestResource
    {
        $this->authorize('update', $purchaseRequest);

        $update->update(
            $purchaseRequest,
            $request->fields(),
            $request->hasItems() ? $request->items() : null,
            $this->actor($request),
            $request->ip(),
        );

        return $this->resource($purchaseRequest);
    }

    /**
     * DELETE /api/v1/purchase-requests/{purchaseRequest}: a soft cancel (204).
     */
    public function destroy(CancelPurchaseRequestRequest $request, PurchaseRequest $purchaseRequest, UpdatePurchaseRequestAction $update): Response
    {
        $this->authorize('update', $purchaseRequest);

        $update->cancel($purchaseRequest, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * POST /api/v1/purchase-requests/{purchaseRequest}/decisions
     */
    public function decide(DecidePurchaseRequestRequest $request, PurchaseRequest $purchaseRequest, DecidePurchaseRequestAction $decide): PurchaseRequestResource
    {
        $this->authorize('decide', $purchaseRequest);

        $decide->execute($purchaseRequest, $request->decisions(), $this->actor($request), $request->ip());

        return $this->resource($purchaseRequest);
    }

    /**
     * Pending PRs the caller may decide: none without `purchase.approve`; their own PRs only with
     * `purchase.approve_own`.
     *
     * @param  Builder<PurchaseRequest>  $query
     */
    private function needingDecisionBy(Builder $query, User $actor): void
    {
        if (! $actor->hasPermission('purchase.approve')) {
            $query->whereRaw('0 = 1');

            return;
        }

        $query->where('status', PurchaseRequest::STATUS_PENDING)
            ->whereHas('items', fn (Builder $items) => $items->where('decision', PurchaseRequestItem::DECISION_PENDING));

        if (! $actor->hasPermission('purchase.approve_own')) {
            $query->where('requested_by', '!=', $actor->id);
        }
    }

    private function resource(PurchaseRequest $purchaseRequest): PurchaseRequestResource
    {
        return new PurchaseRequestResource($purchaseRequest->fresh(PurchaseRequest::resourceRelations()));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
