<?php

namespace App\Http\Resources;

use App\Support\AppVersion;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * POST /api/v1/devices/heartbeat 200 (Hardening & Pilot → C): `{ server_time, app }`, where
 * `app` is `AppVersionInfo`.
 *
 * @property CarbonInterface $resource the server time
 */
class HeartbeatResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'server_time' => $this->resource->toIso8601ZuluString(),
            'app' => (new AppVersionResource(AppVersion::info()))->toArray($request),
        ];
    }
}
