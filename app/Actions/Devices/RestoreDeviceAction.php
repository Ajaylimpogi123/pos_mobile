<?php

namespace App\Actions\Devices;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Device;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/admin/devices/{id}/restore (Hardening & Pilot → C, `system.manage`):
 * reactivates a retired device (`is_active = true`, `retired_at = null`); its staff log in
 * again. Audited `device.restored`. Restoring an active device changes nothing and writes no
 * audit entry.
 */
class RestoreDeviceAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(Device $device, User $actor, ?string $ip): Device
    {
        return DB::transaction(function () use ($device, $actor, $ip): Device {
            /** @var Device $device */
            $device = Device::query()->whereKey($device->id)->lockForUpdate()->firstOrFail();

            if (! $device->isRetired()) {
                return $device;
            }

            $device->forceFill(['is_active' => true, 'retired_at' => null])->save();

            $this->recordAuditLog->execute(
                action: 'device.restored',
                actor: $actor,
                subject: $device,
                changes: ['code' => $device->code, 'name' => $device->name],
                ip: $ip,
            );

            return $device;
        });
    }
}
