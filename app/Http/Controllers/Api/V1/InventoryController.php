<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Inventory\AdjustStockAction;
use App\Actions\Inventory\InventoryQuery;
use App\Actions\Inventory\SetReorderLevelAction;
use App\Actions\Inventory\StockMovementHistory;
use App\Exceptions\ConflictException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\ListInventoryRequest;
use App\Http\Requests\Inventory\ListStockMovementsRequest;
use App\Http\Requests\Inventory\UpdateReorderLevelRequest;
use App\Http\Resources\InventoryItemResource;
use App\Http\Resources\StockMovementResource;
use App\Models\Product;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The Inventory module (v1 completion), scoped to the caller's branch. Reads (list, one item
 * and movement history) need `inventory.adjust` or `report.view`; the reorder level needs
 * `inventory.adjust` (ProductPolicy).
 */
class InventoryController extends Controller
{
    /**
     * GET /api/v1/inventory
     */
    public function index(ListInventoryRequest $request, InventoryQuery $inventory): AnonymousResourceCollection
    {
        $this->authorize('viewInventory', Product::class);

        $branchId = $this->branchId($request->user());
        $search = $request->search();
        $categoryId = $request->integerFilter('category_id');
        $status = $request->status();

        $items = $inventory->items($branchId)
            ->with('category')
            ->when($search !== null, function (Builder $query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn (Builder $q) => $q->where('products.name', 'like', $term)->orWhere('products.sku', 'like', $term));
            })
            ->when($categoryId !== null, fn (Builder $query) => $query->where('products.category_id', $categoryId))
            ->when($status !== null, fn (Builder $query) => $inventory->whereStatus($query, $status))
            ->orderBy('products.name')
            ->orderBy('products.id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        $summary = $inventory->summary($branchId);

        return InventoryItemResource::collection($items)->additional(['meta' => ['summary' => [
            'tracked' => $summary['tracked'],
            'low' => $summary['low'],
            'out' => $summary['out'],
        ]]]);
    }

    /**
     * GET /api/v1/inventory/{product} (Q-020): one tracked product's InventoryItem. A product
     * that doesn't track stock is a 409, as for the reorder level.
     */
    public function show(Request $request, Product $product, InventoryQuery $inventory): InventoryItemResource
    {
        $this->authorize('viewInventory', $product);

        if (! $product->track_stock) {
            throw new ConflictException(AdjustStockAction::MESSAGE_NOT_TRACKED);
        }

        return new InventoryItemResource($this->item($inventory, $this->branchId($request->user()), $product));
    }

    /**
     * GET /api/v1/inventory/{product}/movements
     */
    public function movements(ListStockMovementsRequest $request, Product $product, StockMovementHistory $history): AnonymousResourceCollection
    {
        $this->authorize('viewInventory', $product);

        $movements = $history->query($this->branchId($request->user()), $product->id, $request->type())
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return StockMovementResource::collection($movements);
    }

    /**
     * PUT /api/v1/inventory/{product}/reorder-level
     */
    public function reorderLevel(UpdateReorderLevelRequest $request, Product $product, SetReorderLevelAction $set, InventoryQuery $inventory): InventoryItemResource
    {
        $this->authorize('setReorderLevel', $product);

        /** @var User $actor */
        $actor = $request->user();

        $set->execute($product, $actor, $request->reorderLevel(), $request->ip());

        return new InventoryItemResource($this->item($inventory, $this->branchId($actor), $product));
    }

    /**
     * The product as an InventoryItem of the branch (it tracks stock and isn't deleted).
     */
    private function item(InventoryQuery $inventory, int $branchId, Product $product): Product
    {
        return $inventory->items($branchId)
            ->with('category')
            ->whereKey($product->id)
            ->firstOrFail();
    }

    private function branchId(?User $user): int
    {
        return (int) $user?->branch_id;
    }
}
