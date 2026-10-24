<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `AppVersionInfo` (Hardening & Pilot → C): `{ min_version, latest_version, update_url }`,
 * the GET /api/v1/app-version body (see App\Support\AppVersion).
 *
 * @property array{min_version: string, latest_version: string, update_url: string|null} $resource
 */
class AppVersionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'min_version' => $this->resource['min_version'],
            'latest_version' => $this->resource['latest_version'],
            'update_url' => $this->resource['update_url'],
        ];
    }
}
