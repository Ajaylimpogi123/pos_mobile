<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Recipes\ApplyRecipeCostAction;
use App\Actions\Recipes\BuildRecipe;
use App\Actions\Recipes\SaveRecipeAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Catalog\UpdateRecipeRequest;
use App\Http\Resources\ProductResource;
use App\Http\Resources\RecipeResource;
use App\Models\Product;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * A product's recipe (Ingredients, Recipes & Purchasing → J; permission `product.manage`, via
 * ProductPolicy). Costs use the caller's branch `avg_cost`.
 */
class RecipeController extends Controller
{
    public function __construct(private readonly BuildRecipe $buildRecipe) {}

    /**
     * GET /api/v1/admin/products/{product}/recipe
     */
    public function show(Request $request, Product $product): RecipeResource
    {
        $this->authorize('view', $product);

        return new RecipeResource($this->buildRecipe->execute($product, $this->actor($request)->branch_id));
    }

    /**
     * PUT /api/v1/admin/products/{product}/recipe
     */
    public function update(UpdateRecipeRequest $request, Product $product, SaveRecipeAction $save): RecipeResource
    {
        $this->authorize('update', $product);

        $save->execute($product, $request->recipeLines(), $this->actor($request), $request->ip());

        return new RecipeResource($this->buildRecipe->execute($product->refresh(), $this->actor($request)->branch_id));
    }

    /**
     * POST /api/v1/admin/products/{product}/recipe/apply-cost
     */
    public function applyCost(Request $request, Product $product, ApplyRecipeCostAction $apply): ProductResource
    {
        $this->authorize('update', $product);

        $product = $apply->execute($product, $this->actor($request), $request->ip());
        $branchId = $this->actor($request)->branch_id;

        // The admin `Product` (with cost_cents and the caller's branch stock_qty), as ProductController.
        return new ProductResource($product->load(['category', 'stockLevels' => fn ($query) => $query->where('branch_id', $branchId)]));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
