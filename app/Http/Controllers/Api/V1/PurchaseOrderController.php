<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Purchasing\DecidePurchaseOrderAction;
use App\Actions\Purchasing\ReceiveGoodsAction;
use App\Actions\Purchasing\UpdatePurchaseOrderAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Purchasing\ApprovePurchaseOrderRequest;
use App\Http\Requests\Purchasing\DeclinePurchaseOrderRequest;
use App\Http\Requests\Purchasing\ListPurchaseOrdersRequest;
use App\Http\Requests\Purchasing\StoreGoodsReceiptRequest;
use App\Http\Requests\Purchasing\UpdatePurchaseOrderRequest;
use App\Http\Resources\PurchaseOrderResource;
use App\Models\PurchaseOrder;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Purchase orders and receiving of the caller's branch (Ingredients, Recipes & Purchasing → G,
 * H). Another branch's PO is a 404 (the `{purchaseOrder}` binding, AppServiceProvider).
 * Permissions: PurchaseOrderPolicy.
 */
class PurchaseOrderController extends Controller
{
    /**
     * GET /api/v1/purchase-orders: newest first.
     */
    public function index(ListPurchaseOrdersRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', PurchaseOrder::class);

        $status = $request->validated('status');
        $receivingStatus = $request->validated('receiving_status');
        $supplierId = $request->integerFilter('supplier_id');
        $search = $request->search();
        $toReceive = $request->booleanFilter('to_receive');

        $orders = PurchaseOrder::query()
            ->where('branch_id', $this->actor($request)->branch_id)
            ->with(PurchaseOrder::resourceRelations())
            ->when($status !== null, fn (Builder $query) => $query->where('status', $status))
            ->when($receivingStatus !== null, fn (Builder $query) => $query->where('receiving_status', $receivingStatus))
            ->when($supplierId !== null, fn (Builder $query) => $query->whereHas('lines', fn (Builder $q) => $q->where('supplier_id', $supplierId)))
            ->when($search !== null, function (Builder $query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn (Builder $q) => $q->where('po_no', 'like', $term)
                    ->orWhereHas('purchaseRequest', fn (Builder $pr) => $pr->where('pr_no', 'like', $term))
                    ->orWhereHas('lines', fn (Builder $lines) => $lines
                        ->whereHas('ingredient', fn (Builder $i) => $i->where('name', 'like', $term))
                        ->orWhereHas('product', fn (Builder $p) => $p->where('name', 'like', $term))));
            })
            ->when($toReceive !== null, fn (Builder $query) => $toReceive
                ? $query->where('status', PurchaseOrder::STATUS_APPROVED)->where('receiving_status', '!=', PurchaseOrder::RECEIVING_FULL)
                : $query->where(fn (Builder $q) => $q->where('status', '!=', PurchaseOrder::STATUS_APPROVED)
                    ->orWhere('receiving_status', PurchaseOrder::RECEIVING_FULL)))
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return PurchaseOrderResource::collection($orders);
    }

    /**
     * GET /api/v1/purchase-orders/{purchaseOrder}
     */
    public function show(PurchaseOrder $purchaseOrder): PurchaseOrderResource
    {
        $this->authorize('view', $purchaseOrder);

        return $this->resource($purchaseOrder);
    }

    /**
     * PATCH /api/v1/purchase-orders/{purchaseOrder}
     */
    public function update(UpdatePurchaseOrderRequest $request, PurchaseOrder $purchaseOrder, UpdatePurchaseOrderAction $update): PurchaseOrderResource
    {
        $this->authorize('update', $purchaseOrder);

        $update->execute($purchaseOrder, $request->fields(), $request->lineChanges(), $this->actor($request), $request->ip());

        return $this->resource($purchaseOrder);
    }

    /**
     * POST /api/v1/purchase-orders/{purchaseOrder}/approve
     */
    public function approve(ApprovePurchaseOrderRequest $request, PurchaseOrder $purchaseOrder, DecidePurchaseOrderAction $decide): PurchaseOrderResource
    {
        $this->authorize('approve', $purchaseOrder);

        $decide->approve($purchaseOrder, $this->actor($request), $request->ip());

        return $this->resource($purchaseOrder);
    }

    /**
     * POST /api/v1/purchase-orders/{purchaseOrder}/decline
     */
    public function decline(DeclinePurchaseOrderRequest $request, PurchaseOrder $purchaseOrder, DecidePurchaseOrderAction $decide): PurchaseOrderResource
    {
        $this->authorize('decline', $purchaseOrder);

        $decide->decline($purchaseOrder, $request->reason(), $this->actor($request), $request->ip());

        return $this->resource($purchaseOrder);
    }

    /**
     * POST /api/v1/purchase-orders/{purchaseOrder}/receipts
     */
    public function receive(StoreGoodsReceiptRequest $request, PurchaseOrder $purchaseOrder, ReceiveGoodsAction $receive): JsonResponse
    {
        $this->authorize('receive', $purchaseOrder);

        $receive->execute(
            $purchaseOrder,
            (string) $request->validated('ulid'),
            $request->remarks(),
            $request->receiptLines(),
            $this->actor($request),
            $request->ip(),
        );

        return $this->resource($purchaseOrder)->response()->setStatusCode(201);
    }

    private function resource(PurchaseOrder $purchaseOrder): PurchaseOrderResource
    {
        return new PurchaseOrderResource($purchaseOrder->fresh(PurchaseOrder::resourceRelations()));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
