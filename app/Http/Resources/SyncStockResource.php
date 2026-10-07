<?php

namespace App\Http\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The GET /api/v1/sync/stock body (Phase 5): the caller's branch stock of every
 * non-deleted `track_stock` product, `{ levels: [{ product_id, qty, reorder_level }], recipes, server_time }`
 * (`reorder_level` since Inventory, v1 completion; `recipes: [{ product_id, status: ok|check }]`
 * since Ingredients, Recipes & Purchasing → J).
 *
 * Wraps the array built by App\Actions\Sync\PullStockAction.
 *
 * @property array{levels: list<array{product_id: int, qty: int, reorder_level: int|null}>, recipes: list<array{product_id: int, status: string}>, server_time: CarbonInterface} $resource
 */
class SyncStockResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'levels' => array_map(fn (array $level) => [
                'product_id' => $level['product_id'],
                'qty' => $level['qty'],
                'reorder_level' => $level['reorder_level'],
            ], $this->resource['levels']),
            'recipes' => array_map(fn (array $recipe) => [
                'product_id' => $recipe['product_id'],
                'status' => $recipe['status'],
            ], $this->resource['recipes']),
            'server_time' => $this->resource['server_time']->toIso8601ZuluString(),
        ];
    }
}
