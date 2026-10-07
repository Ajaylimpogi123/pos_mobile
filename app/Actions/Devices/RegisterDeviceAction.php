<?php

namespace App\Actions\Devices;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/devices/register (Phase 5): the app registers itself silently with its
 * per-install `install_id` (PROJECT_MEMORY §8.5; staff never type a device code).
 *
 * - Finds the device with this `install_id`, or creates it in the caller's branch. A new
 *   device gets the code `T` + its id padded to 2 digits (`T01`, … `T123`), assigned right
 *   after the insert, and the `device.registered` audit entry.
 * - A device of another branch → 409.
 * - Updates `name`, `app_version` and `last_seen_at`, and binds the caller's current token
 *   to the device (`personal_access_tokens.device_id`).
 */
class RegisterDeviceAction
{
    public const MESSAGE_OTHER_BRANCH = 'This tablet is registered to another branch.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when the install belongs to another branch's device
     */
    public function execute(User $caller, PersonalAccessToken $token, string $installId, string $name, ?string $appVersion, ?string $ip = null): Device
    {
        try {
            return $this->register($caller, $token, $installId, $name, $appVersion, $ip);
        } catch (UniqueConstraintViolationException) {
            // The same install registered concurrently and won the insert: use its device.
            return $this->register($caller, $token, $installId, $name, $appVersion, $ip);
        }
    }

    private function register(User $caller, PersonalAccessToken $token, string $installId, string $name, ?string $appVersion, ?string $ip): Device
    {
        return DB::transaction(function () use ($caller, $token, $installId, $name, $appVersion, $ip): Device {
            $device = Device::withTrashed()->where('install_id', $installId)->lockForUpdate()->first();

            if ($device !== null && $device->branch_id !== (int) $caller->branch_id) {
                throw new ConflictException(self::MESSAGE_OTHER_BRANCH);
            }

            $created = $device === null;

            if ($created) {
                $device = new Device;
                $device->forceFill([
                    'branch_id' => $caller->branch_id,
                    'install_id' => $installId,
                    // Placeholder until the id is known (the column is NOT NULL and UNIQUE).
                    'code' => '#'.substr($installId, 7),
                    'name' => $name,
                    'is_active' => true,
                ])->save();
            } elseif ($device->trashed()) {
                $device->restore();
            }

            $device->forceFill([
                'code' => $created ? Device::codeFor($device->id) : $device->code,
                'name' => $name,
                'app_version' => $appVersion,
                'last_seen_at' => now(),
            ])->save();

            $token->forceFill(['device_id' => $device->id])->save();

            if ($created) {
                $this->recordAuditLog->execute(
                    action: 'device.registered',
                    actor: $caller,
                    subject: $device,
                    changes: ['code' => $device->code, 'name' => $device->name, 'app_version' => $device->app_version],
                    ip: $ip,
                );
            }

            return $device;
        });
    }
}
