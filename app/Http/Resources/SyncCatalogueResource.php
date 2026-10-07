<?php

namespace App\Http\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's GET /api/v1/sync/catalogue body (Phase 2): `data` holds the page's
 * categories, products and tombstones; `meta` holds the run state and the cursor.
 *
 * Wraps the array built by App\Actions\Sync\PullCatalogueAction.
 *
 * @property array<string, mixed> $resource
 */
class SyncCatalogueResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'categories' => SyncCategoryResource::collection($this->resource['categories']),
            'products' => SyncProductResource::collection($this->resource['products']),
            'deleted' => [
                'categories' => $this->resource['deleted']['categories'],
                'products' => $this->resource['deleted']['products'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function with(Request $request): array
    {
        /** @var CarbonInterface $serverTime */
        $serverTime = $this->resource['server_time'];

        return [
            'meta' => [
                'full' => $this->resource['full'],
                'has_more' => $this->resource['has_more'],
                'next_cursor' => $this->resource['next_cursor'],
                'server_time' => $serverTime->toIso8601ZuluString(),
            ],
        ];
    }
}
