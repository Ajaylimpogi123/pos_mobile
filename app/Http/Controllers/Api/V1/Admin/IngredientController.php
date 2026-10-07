<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Catalog\DeleteIngredientAction;
use App\Actions\Catalog\RemoveCatalogImageAction;
use App\Actions\Catalog\SaveIngredientAction;
use App\Actions\Catalog\StoreCatalogImageAction;
use App\Actions\Inventory\IngredientInventoryQuery;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Ingredients\ListIngredientsRequest;
use App\Http\Requests\Admin\Ingredients\StoreIngredientImageRequest;
use App\Http\Requests\Admin\Ingredients\StoreIngredientRequest;
use App\Http\Requests\Admin\Ingredients\UpdateIngredientRequest;
use App\Http\Resources\IngredientResource;
use App\Models\Ingredient;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Ingredients (Ingredients, Recipes & Purchasing → D), the admin CRUD pattern with a multipart
 * image like products: managed with `product.manage`; listed and read also with
 * `inventory.adjust`, any purchase permission or `report.view` (IngredientPolicy). Every
 * response is an `Ingredient` with the caller's branch stock.
 */
class IngredientController extends Controller
{
    public function __construct(private readonly IngredientInventoryQuery $inventory) {}

    /**
     * GET /api/v1/admin/ingredients
     */
    public function index(ListIngredientsRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Ingredient::class);

        $search = $request->search();
        $isActive = $request->booleanFilter('is_active');

        $ingredients = $this->inventory->items($this->actor($request)->branch_id)
            ->with('units')
            ->when($search !== null, fn (Builder $query) => $query->where('ingredients.name', 'like', SearchPattern::contains($search)))
            ->when($isActive !== null, fn (Builder $query) => $query->where('ingredients.is_active', $isActive))
            ->orderBy('ingredients.name')
            ->orderBy('ingredients.id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return IngredientResource::collection($ingredients);
    }

    /**
     * POST /api/v1/admin/ingredients
     */
    public function store(StoreIngredientRequest $request, SaveIngredientAction $save): JsonResponse
    {
        $this->authorize('create', Ingredient::class);

        $ingredient = $save->create($request->ingredientAttributes(), $request->units(), $this->actor($request), $request->ip());

        return $this->resource($request, $ingredient)->response()->setStatusCode(201);
    }

    /**
     * GET /api/v1/admin/ingredients/{ingredient}
     */
    public function show(Request $request, Ingredient $ingredient): IngredientResource
    {
        $this->authorize('view', $ingredient);

        return $this->resource($request, $ingredient);
    }

    /**
     * PATCH /api/v1/admin/ingredients/{ingredient}
     */
    public function update(UpdateIngredientRequest $request, Ingredient $ingredient, SaveIngredientAction $save): IngredientResource
    {
        $this->authorize('update', $ingredient);

        $save->update($ingredient, $request->ingredientAttributes(), $request->units(), $this->actor($request), $request->ip());

        return $this->resource($request, $ingredient);
    }

    /**
     * DELETE /api/v1/admin/ingredients/{ingredient}
     */
    public function destroy(Request $request, Ingredient $ingredient, DeleteIngredientAction $delete): Response
    {
        $this->authorize('delete', $ingredient);

        $delete->execute($ingredient, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * POST /api/v1/admin/ingredients/{ingredient}/image (multipart, field `image`)
     */
    public function storeImage(StoreIngredientImageRequest $request, Ingredient $ingredient, StoreCatalogImageAction $store): IngredientResource
    {
        $this->authorize('update', $ingredient);

        $store->execute($ingredient, $request->uploadedImage(), $this->actor($request), $request->ip());

        return $this->resource($request, $ingredient);
    }

    /**
     * DELETE /api/v1/admin/ingredients/{ingredient}/image
     */
    public function destroyImage(Request $request, Ingredient $ingredient, RemoveCatalogImageAction $remove): IngredientResource
    {
        $this->authorize('update', $ingredient);

        $remove->execute($ingredient, $this->actor($request), $request->ip());

        return $this->resource($request, $ingredient);
    }

    /**
     * The ingredient as an `Ingredient` with the caller's branch stock.
     */
    private function resource(Request $request, Ingredient $ingredient): IngredientResource
    {
        return new IngredientResource(
            $this->inventory->items($this->actor($request)->branch_id)->with('units')->whereKey($ingredient->id)->firstOrFail(),
        );
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
