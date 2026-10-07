<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Inventory\IngredientInventoryQuery;
use App\Actions\Inventory\SetIngredientReorderLevelAction;
use App\Actions\Inventory\StockMovementHistory;
use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\ListIngredientInventoryRequest;
use App\Http\Requests\Inventory\ListIngredientMovementsRequest;
use App\Http\Requests\Inventory\UpdateIngredientReorderLevelRequest;
use App\Http\Resources\IngredientMovementResource;
use App\Http\Resources\IngredientResource;
use App\Models\Ingredient;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Ingredient inventory (Ingredients, Recipes & Purchasing → D), mirroring the product Inventory
 * module, scoped to the caller's branch. Reads need `inventory.adjust` or `report.view`; the
 * reorder level needs `inventory.adjust` (IngredientPolicy).
 */
class IngredientInventoryController extends Controller
{
    public function __construct(private readonly IngredientInventoryQuery $inventory) {}

    /**
     * GET /api/v1/inventory/ingredients: every non-deleted ingredient (inactive ones included),
     * by name then id; `meta.summary = { tracked, low, out }` covers the whole branch.
     */
    public function index(ListIngredientInventoryRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewInventory', Ingredient::class);

        $branchId = $this->branchId($request);
        $search = $request->search();
        $status = $request->status();

        $items = $this->inventory->items($branchId)
            ->with('units')
            ->when($search !== null, fn (Builder $query) => $query->where('ingredients.name', 'like', SearchPattern::contains($search)))
            ->when($status !== null, fn (Builder $query) => $this->inventory->whereStatus($query, (string) $status))
            ->orderBy('ingredients.name')
            ->orderBy('ingredients.id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        $summary = $this->inventory->summary($branchId);

        return IngredientResource::collection($items)->additional(['meta' => ['summary' => [
            'tracked' => $summary['tracked'],
            'low' => $summary['low'],
            'out' => $summary['out'],
        ]]]);
    }

    /**
     * GET /api/v1/inventory/ingredients/{ingredient}
     */
    public function show(Request $request, Ingredient $ingredient): IngredientResource
    {
        $this->authorize('viewInventory', $ingredient);

        return $this->item($request, $ingredient);
    }

    /**
     * GET /api/v1/inventory/ingredients/{ingredient}/movements
     */
    public function movements(ListIngredientMovementsRequest $request, Ingredient $ingredient, StockMovementHistory $history): AnonymousResourceCollection
    {
        $this->authorize('viewInventory', $ingredient);

        $movements = $history->forIngredient($this->branchId($request), $ingredient->id, $request->type())
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return IngredientMovementResource::collection($movements);
    }

    /**
     * PUT /api/v1/inventory/ingredients/{ingredient}/reorder-level
     */
    public function reorderLevel(UpdateIngredientReorderLevelRequest $request, Ingredient $ingredient, SetIngredientReorderLevelAction $set): IngredientResource
    {
        $this->authorize('setReorderLevel', $ingredient);

        /** @var User $actor */
        $actor = $request->user();

        $set->execute($ingredient, $actor, $request->baseReorderLevel(), $request->ip());

        return $this->item($request, $ingredient);
    }

    private function item(Request $request, Ingredient $ingredient): IngredientResource
    {
        return new IngredientResource(
            $this->inventory->items($this->branchId($request))->with('units')->whereKey($ingredient->id)->firstOrFail(),
        );
    }

    private function branchId(Request $request): int
    {
        return (int) $request->user()?->branch_id;
    }
}
