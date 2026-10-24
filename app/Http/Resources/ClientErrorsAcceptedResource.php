<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * POST /api/v1/client-errors 202 (Hardening & Pilot → B): `{ accepted, duplicates }`.
 *
 * @property array{accepted: int, duplicates: int} $resource
 */
class ClientErrorsAcceptedResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'accepted' => $this->resource['accepted'],
            'duplicates' => $this->resource['duplicates'],
        ];
    }
}
