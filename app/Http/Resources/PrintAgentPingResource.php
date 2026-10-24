<?php

namespace App\Http\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET /api/v1/print-agent/ping (Web POS & Print Bridge → E): `{ server_time }`.
 *
 * @property CarbonInterface $resource
 */
class PrintAgentPingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'server_time' => $this->resource->toIso8601ZuluString(),
        ];
    }
}
