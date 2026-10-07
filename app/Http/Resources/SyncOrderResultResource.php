<?php

namespace App\Http\Resources;

use App\Actions\Sync\OfflineOrderResult;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One result of POST /api/v1/sync/orders (Phase 5): `{ ulid, status, order, message }`.
 * `order` is the stored `Order` for `accepted` and `duplicate`, and null for `rejected`,
 * which carries the reason in `message`.
 *
 * @property OfflineOrderResult $resource
 */
class SyncOrderResultResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $result = $this->resource;

        return [
            'ulid' => $result->ulid,
            'status' => $result->status,
            'order' => $result->order === null ? null : new OrderResource($result->order),
            'message' => $result->message,
        ];
    }
}
