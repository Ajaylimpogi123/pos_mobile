<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Catalog\CreateProductAction;
use App\Actions\Catalog\DeleteProductAction;
use App\Actions\Catalog\RemoveCatalogImageAction;
use App\Actions\Catalog\StoreCatalogImageAction;
use App\Actions\Catalog\UpdateProductAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Catalog\ListProductsRequest;
use App\Http\Requests\Admin\Catalog\StoreProductImageRequest;
use App\Http\Requests\Admin\Catalog\StoreProductRequest;
use App\Http\Requests\Admin\Catalog\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Admin management of products (permission `product.manage`).
 * Responses include `cost_cents` and the caller's branch `stock_qty` (see ProductResource).
 */
class ProductController extends Controller
{
    /**
     * GET /api/v1/admin/products
     */
    public function index(ListProductsRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Product::class);

        $search = $request->search();
        $categoryId = $request->integerFilter('category_id');
        $isAvailable = $request->booleanFilter('is_available');

        $products = Product::query()
            ->with($this->relations($request))
            ->when($search !== null, function ($query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn ($q) => $q->where('name', 'like', $term)->orWhere('sku', 'like', $term));
            })
            ->when($categoryId !== null, fn ($query) => $query->where('category_id', $categoryId))
            ->when($isAvailable !== null, fn ($query) => $query->where('is_available', $isAvailable))
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return ProductResource::collection($products);
    }

    /**
     * POST /api/v1/admin/products
     */
    public function store(StoreProductRequest $request, CreateProductAction $create): JsonResponse
    {
        $this->authorize('create', Product::class);

        $product = $create->execute($request->productAttributes(), $this->actor($request), $request->ip());

        return (new ProductResource($product->load($this->relations($request))))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/admin/products/{product}
     */
    public function show(Request $request, Product $product): ProductResource
    {
        $this->authorize('view', $product);

        return new ProductResource($product->load($this->relations($request)));
    }

    /**
     * PATCH /api/v1/admin/products/{product}
     */
    public function update(UpdateProductRequest $request, Product $product, UpdateProductAction $update): ProductResource
    {
        $this->authorize('update', $product);

        $product = $update->execute($product, $request->productAttributes(), $this->actor($request), $request->ip());

        // Reload: the category may have changed.
        return new ProductResource($product->load($this->relations($request)));
    }

    /**
     * DELETE /api/v1/admin/products/{product}
     */
    public function destroy(Request $request, Product $product, DeleteProductAction $delete): Response
    {
        $this->authorize('delete', $product);

        $delete->execute($product, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * POST /api/v1/admin/products/{product}/image (multipart, field `image`)
     */
    public function storeImage(StoreProductImageRequest $request, Product $product, StoreCatalogImageAction $store): ProductResource
    {
        $this->authorize('update', $product);

        $store->execute($product, $request->uploadedImage(), $this->actor($request), $request->ip());

        return new ProductResource($product->load($this->relations($request)));
    }

    /**
     * DELETE /api/v1/admin/products/{product}/image
     */
    public function destroyImage(Request $request, Product $product, RemoveCatalogImageAction $remove): ProductResource
    {
        $this->authorize('update', $product);

        $remove->execute($product, $this->actor($request), $request->ip());

        return new ProductResource($product->load($this->relations($request)));
    }

    /**
     * What ProductResource reads on admin routes: the category, and the stock level of
     * the caller's branch only (for `stock_qty`).
     *
     * @return array<int|string, mixed>
     */
    private function relations(Request $request): array
    {
        $branchId = $this->actor($request)->branch_id;

        return ['category', 'stockLevels' => fn ($query) => $query->where('branch_id', $branchId)];
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
