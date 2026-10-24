<?php

namespace App\Http\Resources;

use App\Actions\Devices\RecordHeartbeatAction;
use App\Models\Device;
use App\Models\User;
use App\Support\Devices\DeviceHealth;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `AdminDevice` (Hardening & Pilot → C): an item of GET /api/v1/admin/devices and the 200 body
 * of rename, retire and restore. `heartbeat` is null until the first heartbeat; `health` is
 * derived (App\Support\Devices\DeviceHealth).
 *
 * @mixin Device
 */
class AdminDeviceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Device $device */
        $device = $this->resource;
        /** @var User|null $lastUser */
        $lastUser = $device->lastUser;

        return [
            'id' => $device->id,
            'code' => $device->code,
            'name' => $device->name,
            'platform' => $device->platform,
            'app_version' => $device->app_version,
            'last_seen_at' => $device->last_seen_at?->toIso8601ZuluString(),
            'is_active' => $device->is_active,
            'retired_at' => $device->retired_at?->toIso8601ZuluString(),
            'last_user' => $lastUser !== null ? ['id' => $lastUser->id, 'name' => $lastUser->name] : null,
            'heartbeat' => $this->heartbeat($device->last_heartbeat),
            'heartbeat_at' => $device->last_heartbeat_at?->toIso8601ZuluString(),
            'health' => DeviceHealth::of($device),
        ];
    }

    /**
     * The stored heartbeat with every `DeviceHeartbeat` key, in order.
     *
     * @param  array<string, mixed>|null  $stored
     * @return array<string, mixed>|null
     */
    private function heartbeat(?array $stored): ?array
    {
        if ($stored === null) {
            return null;
        }

        $heartbeat = [];

        foreach (RecordHeartbeatAction::KEYS as $key) {
            $heartbeat[$key] = $stored[$key] ?? null;
        }

        $heartbeat['printers'] = array_values($stored['printers'] ?? []);

        return $heartbeat;
    }
}
