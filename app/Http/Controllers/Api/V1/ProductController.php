<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\ListProductsRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Support\SearchPattern;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ProductController extends Controller
{
    /**
     * GET /api/v1/products (any authenticated user)
     *
     * Non-deleted products whose category is active and non-deleted, including
     * unavailable ones, ordered by sort_order, name, id, cursor-paginated.
     * An unknown or inactive `category_id` yields an empty list. No `cost_cents`.
     */
    public function index(ListProductsRequest $request): AnonymousResourceCollection
    {
        $categoryId = $request->integerFilter('category_id');
        $search = $request->search();

        $products = Product::query()
            ->with('category')
            ->whereHas('category', fn ($query) => $query->where('is_active', true))
            ->when($categoryId !== null, fn ($query) => $query->where('category_id', $categoryId))
            ->when($search !== null, function ($query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn ($q) => $q->where('name', 'like', $term)->orWhere('sku', 'like', $term));
            })
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return ProductResource::collection($products);
    }
}
