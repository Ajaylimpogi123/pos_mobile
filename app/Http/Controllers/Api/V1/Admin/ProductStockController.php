<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Inventory\AdjustStockAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Catalog\StoreStockAdjustmentRequest;
use App\Http\Resources\StockAdjustmentResource;
use App\Models\Product;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Stock adjustments of a product in the caller's branch (Phase 3, permission
 * `inventory.adjust`, idempotent); since Inventory (v1 completion) also stock in, counts and
 * wastage (`type`).
 */
class ProductStockController extends Controller
{
    /**
     * POST /api/v1/admin/products/{product}/stock-adjustments
     */
    public function store(StoreStockAdjustmentRequest $request, Product $product, AdjustStockAction $adjust): JsonResponse
    {
        $this->authorize('adjustStock', $product);

        /** @var User $actor */
        $actor = $request->user();

        $result = $adjust->execute(
            product: $product,
            actor: $actor,
            ulid: $request->validated('ulid'),
            qtyDelta: $request->qtyDelta(),
            countedQty: $request->countedQty(),
            reason: $request->reason(),
            ip: $request->ip(),
            type: $request->type(),
            unitCostCents: $request->unitCostCents(),
        );

        return (new StockAdjustmentResource($result))
            ->response()
            ->setStatusCode(201);
    }
}
