<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Purchasing\DeleteSupplierAction;
use App\Actions\Purchasing\SaveSupplierAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Purchasing\ListSuppliersRequest;
use App\Http\Requests\Admin\Purchasing\StoreSupplierRequest;
use App\Http\Requests\Admin\Purchasing\UpdateSupplierRequest;
use App\Http\Resources\SupplierResource;
use App\Models\Supplier;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Suppliers (Ingredients, Recipes & Purchasing → C), the admin CRUD pattern: managed with
 * `supplier.manage`; listed and read with it or any purchase permission (SupplierPolicy).
 */
class SupplierController extends Controller
{
    /**
     * GET /api/v1/admin/suppliers
     */
    public function index(ListSuppliersRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Supplier::class);

        $search = $request->search();
        $isActive = $request->booleanFilter('is_active');

        $suppliers = Supplier::query()
            ->when($search !== null, function (Builder $query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn (Builder $q) => $q->where('name', 'like', $term)
                    ->orWhere('contact_person', 'like', $term)
                    ->orWhere('contact_number', 'like', $term));
            })
            ->when($isActive !== null, fn (Builder $query) => $query->where('is_active', $isActive))
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return SupplierResource::collection($suppliers);
    }

    /**
     * POST /api/v1/admin/suppliers
     */
    public function store(StoreSupplierRequest $request, SaveSupplierAction $save): JsonResponse
    {
        $this->authorize('create', Supplier::class);

        $supplier = $save->create($request->validated(), $this->actor($request), $request->ip());

        return (new SupplierResource($supplier->refresh()))->response()->setStatusCode(201);
    }

    /**
     * GET /api/v1/admin/suppliers/{supplier}
     */
    public function show(Supplier $supplier): SupplierResource
    {
        $this->authorize('view', $supplier);

        return new SupplierResource($supplier);
    }

    /**
     * PATCH /api/v1/admin/suppliers/{supplier}
     */
    public function update(UpdateSupplierRequest $request, Supplier $supplier, SaveSupplierAction $save): SupplierResource
    {
        $this->authorize('update', $supplier);

        return new SupplierResource($save->update($supplier, $request->validated(), $this->actor($request), $request->ip()));
    }

    /**
     * DELETE /api/v1/admin/suppliers/{supplier}
     */
    public function destroy(Request $request, Supplier $supplier, DeleteSupplierAction $delete): Response
    {
        $this->authorize('delete', $supplier);

        $delete->execute($supplier, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
