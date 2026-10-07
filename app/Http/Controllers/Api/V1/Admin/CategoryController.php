<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Catalog\CreateCategoryAction;
use App\Actions\Catalog\DeleteCategoryAction;
use App\Actions\Catalog\RemoveCatalogImageAction;
use App\Actions\Catalog\StoreCatalogImageAction;
use App\Actions\Catalog\UpdateCategoryAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Catalog\ListCategoriesRequest;
use App\Http\Requests\Admin\Catalog\StoreCategoryImageRequest;
use App\Http\Requests\Admin\Catalog\StoreCategoryRequest;
use App\Http\Requests\Admin\Catalog\UpdateCategoryRequest;
use App\Http\Resources\CategoryResource;
use App\Models\Category;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Admin management of categories (permission `product.manage`).
 * `products_count` counts all non-deleted products here.
 */
class CategoryController extends Controller
{
    /**
     * GET /api/v1/admin/categories
     */
    public function index(ListCategoriesRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Category::class);

        $search = $request->search();
        $isActive = $request->booleanFilter('is_active');

        $categories = Category::query()
            ->withCount('products')
            ->when($search !== null, fn ($query) => $query->where('name', 'like', SearchPattern::contains($search)))
            ->when($isActive !== null, fn ($query) => $query->where('is_active', $isActive))
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return CategoryResource::collection($categories);
    }

    /**
     * POST /api/v1/admin/categories
     */
    public function store(StoreCategoryRequest $request, CreateCategoryAction $create): JsonResponse
    {
        $this->authorize('create', Category::class);

        $category = $create->execute($request->validated(), $this->actor($request), $request->ip());

        return (new CategoryResource($category->loadCount('products')))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/admin/categories/{category}
     */
    public function show(Category $category): CategoryResource
    {
        $this->authorize('view', $category);

        return new CategoryResource($category->loadCount('products'));
    }

    /**
     * PATCH /api/v1/admin/categories/{category}
     */
    public function update(UpdateCategoryRequest $request, Category $category, UpdateCategoryAction $update): CategoryResource
    {
        $this->authorize('update', $category);

        $category = $update->execute($category, $request->validated(), $this->actor($request), $request->ip());

        return new CategoryResource($category->loadCount('products'));
    }

    /**
     * DELETE /api/v1/admin/categories/{category}
     */
    public function destroy(Request $request, Category $category, DeleteCategoryAction $delete): Response
    {
        $this->authorize('delete', $category);

        $delete->execute($category, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * POST /api/v1/admin/categories/{category}/image (multipart, field `image`)
     */
    public function storeImage(StoreCategoryImageRequest $request, Category $category, StoreCatalogImageAction $store): CategoryResource
    {
        $this->authorize('update', $category);

        $store->execute($category, $request->uploadedImage(), $this->actor($request), $request->ip());

        return new CategoryResource($category->loadCount('products'));
    }

    /**
     * DELETE /api/v1/admin/categories/{category}/image
     */
    public function destroyImage(Request $request, Category $category, RemoveCatalogImageAction $remove): CategoryResource
    {
        $this->authorize('update', $category);

        $remove->execute($category, $this->actor($request), $request->ip());

        return new CategoryResource($category->loadCount('products'));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
