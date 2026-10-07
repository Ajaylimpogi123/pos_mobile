<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Inventory\IngredientInventoryQuery;
use App\Actions\Inventory\SetIngredientCostAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Ingredients\SetIngredientCostRequest;
use App\Http\Resources\IngredientResource;
use App\Models\Ingredient;
use App\Models\User;

/**
 * An ingredient's manual cost in the caller's branch (Ingredients, Recipes & Purchasing → D1;
 * permission `inventory.adjust`, idempotent).
 */
class IngredientCostController extends Controller
{
    /**
     * POST /api/v1/admin/ingredients/{ingredient}/cost → 200 { data: Ingredient }
     */
    public function store(SetIngredientCostRequest $request, Ingredient $ingredient, SetIngredientCostAction $setCost, IngredientInventoryQuery $inventory): IngredientResource
    {
        $this->authorize('setCost', $ingredient);

        /** @var User $actor */
        $actor = $request->user();

        $setCost->execute(
            ingredient: $ingredient,
            actor: $actor,
            ulid: (string) $request->validated('ulid'),
            costCents: $request->costCents(),
            unit: $request->unit(),
            reason: $request->reason(),
            ip: $request->ip(),
        );

        return new IngredientResource(
            $inventory->items($actor->branch_id)->with('units')->whereKey($ingredient->id)->firstOrFail(),
        );
    }
}
