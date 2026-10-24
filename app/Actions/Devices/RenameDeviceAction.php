<?php

namespace App\Actions\Devices;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Device;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * PATCH /api/v1/admin/devices/{id} (Hardening & Pilot → C, `system.manage`): renames the
 * device. Audited `device.renamed` with the change; nothing is written when the name is not
 * sent or unchanged.
 */
class RenameDeviceAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $data  validated
     */
    public function execute(Device $device, array $data, User $actor, ?string $ip): Device
    {
        if (! array_key_exists('name', $data)) {
            return $device;
        }

        return DB::transaction(function () use ($device, $data, $actor, $ip): Device {
            $device->name = (string) $data['name'];
            $changes = ModelChanges::diff($device);

            if ($changes === []) {
                return $device;
            }

            $device->save();

            $this->recordAuditLog->execute(
                action: 'device.renamed',
                actor: $actor,
                subject: $device,
                changes: $changes,
                ip: $ip,
            );

            return $device;
        });
    }
}
