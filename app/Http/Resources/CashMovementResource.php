<?php

namespace App\Http\Resources;

use App\Models\CashMovement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `CashMovement` object (Phase 6):
 * `{ ulid, type, amount_cents, reason, occurred_at, user: {id, name} }`. Load `user`.
 *
 * @mixin CashMovement
 */
class CashMovementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var CashMovement $movement */
        $movement = $this->resource;

        return [
            'ulid' => $movement->ulid,
            'type' => $movement->type,
            'amount_cents' => $movement->amount_cents,
            'reason' => $movement->reason,
            'occurred_at' => $movement->occurred_at->toIso8601ZuluString(),
            'user' => ['id' => $movement->user->id, 'name' => $movement->user->name],
        ];
    }
}
