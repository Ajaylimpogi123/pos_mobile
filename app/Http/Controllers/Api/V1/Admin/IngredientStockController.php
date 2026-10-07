<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Inventory\AdjustIngredientStockAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Ingredients\StoreIngredientStockAdjustmentRequest;
use App\Http\Resources\IngredientStockAdjustmentResource;
use App\Models\Ingredient;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Stock adjustments of an ingredient in the caller's branch (Ingredients, Recipes & Purchasing
 * → D; permission `inventory.adjust`, idempotent): adjustments, counts and wastage with a
 * quantity and unit. Stock in comes from receiving.
 */
class IngredientStockController extends Controller
{
    /**
     * POST /api/v1/admin/ingredients/{ingredient}/stock-adjustments
     */
    public function store(StoreIngredientStockAdjustmentRequest $request, Ingredient $ingredient, AdjustIngredientStockAction $adjust): JsonResponse
    {
        $this->authorize('adjustStock', $ingredient);

        /** @var User $actor */
        $actor = $request->user();

        $result = $adjust->execute(
            ingredient: $ingredient,
            actor: $actor,
            ulid: (string) $request->validated('ulid'),
            type: $request->type(),
            qty: $request->qty(),
            unit: $request->unit(),
            reason: $request->reason(),
            ip: $request->ip(),
        );

        return (new IngredientStockAdjustmentResource($result))->response()->setStatusCode(201);
    }
}
