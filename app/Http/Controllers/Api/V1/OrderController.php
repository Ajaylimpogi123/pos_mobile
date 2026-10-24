<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Sales\CompleteSaleAction;
use App\Actions\Sales\MarkOrderReviewedAction;
use App\Actions\Sales\RecordOrder;
use App\Actions\Sales\RefundOrderAction;
use App\Actions\Sales\VoidOrderAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Sales\ListOrdersRequest;
use App\Http\Requests\Sales\ReviewOrderRequest;
use App\Http\Requests\Sales\StoreOrderRequest;
use App\Http\Requests\Sales\StoreRefundRequest;
use App\Http\Requests\Sales\VoidOrderRequest;
use App\Http\Resources\OrderResource;
use App\Http\Resources\OrderSummaryResource;
use App\Models\Device;
use App\Models\Order;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Sales (Phase 3): complete a sale online (`sale.create`, idempotent) and order history
 * (`sale.create` or `report.view`, with the visibility rule of OrderPolicy / Order::visibleTo).
 * Phase 5: the `needs_review` filter, and marking a flagged offline sale reviewed
 * (`order.review`). Phase 7: the `status` filter, voids and refunds (idempotent; manager PIN
 * approval when the caller lacks `sale.void` / `sale.refund`).
 */
class OrderController extends Controller
{
    /**
     * GET /api/v1/orders
     *
     * Visible orders, newest first (placed_at, then id, descending), cursor-paginated.
     */
    public function index(ListOrdersRequest $request): AnonymousResourceCollection
    {
        $caller = $this->actor($request);
        $cashierId = $request->integerFilter('cashier_id');

        // 403 when filtering on another cashier without `report.view`.
        $this->authorize('viewAny', [Order::class, $cashierId]);

        $businessDate = $request->businessDate();
        $search = $request->search();

        $needsReview = $request->booleanFilter('needs_review');
        $status = $request->validated('status');

        $orders = Order::query()
            ->visibleTo($caller)
            ->with(['cashier:id,name', 'customer:id,first_name,last_name', 'reviewer:id,name', 'payments:id,order_id,method', 'tab:id,ulid'])
            ->withSum('items', 'qty')
            ->when($businessDate !== null, fn ($query) => $query->where('business_date', $businessDate))
            ->when($cashierId !== null, fn ($query) => $query->where('user_id', $cashierId))
            ->when($needsReview !== null, fn ($query) => $query->where('needs_review', $needsReview))
            ->when($status !== null, fn ($query) => $query->where('status', $status))
            ->when($search !== null, fn ($query) => $query->where('invoice_no', 'like', SearchPattern::contains($search)))
            ->orderByDesc('placed_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return OrderSummaryResource::collection($orders);
    }

    /**
     * POST /api/v1/orders (idempotent: `Idempotency-Key` = the body's `ulid`)
     */
    public function store(StoreOrderRequest $request, CompleteSaleAction $completeSale): JsonResponse
    {
        $this->authorize('create', Order::class);

        $caller = $this->actor($request);

        // Phase 5: the order records the device the token is bound to (or null).
        $order = $completeSale->execute($caller, $request->validated(), $request->ip(), Device::ofSession($caller));

        return (new OrderResource($order))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/orders/{ulid}
     *
     * 403 without `sale.create` or `report.view`; an order that is not visible to the
     * caller, or does not exist, is a 404.
     */
    public function show(Request $request, string $ulid): OrderResource
    {
        $this->authorize('viewAny', Order::class);

        $order = Order::query()
            ->visibleTo($this->actor($request))
            ->where('ulid', strtoupper($ulid))
            ->firstOrFail();

        $this->authorize('view', $order);

        return new OrderResource($order->load(RecordOrder::RESOURCE_RELATIONS));
    }

    /**
     * POST /api/v1/orders/{ulid}/review (Phase 5)
     *
     * 403 without `order.review`; an order that is not visible to the caller, or does not
     * exist, is a 404; 409 when it doesn't need review.
     */
    public function review(ReviewOrderRequest $request, string $ulid, MarkOrderReviewedAction $markReviewed): OrderResource
    {
        $caller = $this->actor($request);

        $order = Order::query()
            ->visibleTo($caller)
            ->where('ulid', strtoupper($ulid))
            ->firstOrFail();

        $this->authorize('review', $order);

        return new OrderResource($markReviewed->execute($order, $caller, $request->validated('note'), $request->ip()));
    }

    /**
     * POST /api/v1/orders/{ulid}/void (Phase 7; idempotent)
     *
     * 403 without `sale.create` or `sale.void`; 409 without a device; 404 for an order the
     * caller can't see; then the state, window and approval checks of VoidOrderAction.
     */
    public function void(VoidOrderRequest $request, VoidOrderAction $voidOrder): OrderResource
    {
        $order = $request->order();

        $this->authorize('void', $order);

        return new OrderResource($voidOrder->execute($this->actor($request), $request->device(), $order, $request->validated(), $request->ip()));
    }

    /**
     * POST /api/v1/orders/{ulid}/refunds (Phase 7; idempotent: `Idempotency-Key` = the body's `ulid`)
     *
     * 403 without `sale.create` or `sale.refund`; 409 without a device; 404 for an order the
     * caller can't see; then the checks of RefundOrderAction. 201 with the order, whose
     * `refunds` include the new one.
     */
    public function refund(StoreRefundRequest $request, RefundOrderAction $refundOrder): JsonResponse
    {
        $order = $request->order();

        $this->authorize('refund', $order);

        $order = $refundOrder->execute($this->actor($request), $request->device(), $order, $request->validated(), $request->ip());

        return (new OrderResource($order))
            ->response()
            ->setStatusCode(201);
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
