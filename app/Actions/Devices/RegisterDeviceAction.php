<?php

namespace App\Actions\Devices;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * POST /api/v1/devices/register (Phase 5): the app registers itself silently with its
 * per-install `install_id` (PROJECT_MEMORY §8.5; staff never type a device code).
 *
 * - Finds the device with this `install_id`, or creates it in the caller's branch. A new
 *   device gets its `platform` (`android` unless the client sent `web`; Web POS → C) and
 *   the code `T` (or `W` for a web terminal) + its id padded to 2 digits (`T01`, … `T123`,
 *   `W03`), assigned right after the insert, and the `device.registered` audit entry. An
 *   existing device's code and platform never change.
 * - A device of another branch → 409.
 * - A retired device (Hardening & Pilot → C) → 403 "This tablet has been retired. Ask a manager
 *   to restore it.", and the token is not bound.
 * - Updates `app_version` and `last_seen_at`, and binds the caller's current token to the
 *   device (`personal_access_tokens.device_id`). The sent `name` is only used when the device
 *   is created: an existing device keeps its name, so an admin rename lasts (Q-044).
 */
class RegisterDeviceAction
{
    public const MESSAGE_OTHER_BRANCH = 'This tablet is registered to another branch.';

    public const MESSAGE_RETIRED = 'This tablet has been retired. Ask a manager to restore it.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when the install belongs to another branch's device
     * @throws AccessDeniedHttpException 403 when the install's device is retired
     */
    public function execute(User $caller, PersonalAccessToken $token, string $installId, string $name, ?string $appVersion, ?string $ip = null, ?string $platform = null): Device
    {
        $platform ??= Device::PLATFORM_ANDROID;

        try {
            return $this->register($caller, $token, $installId, $name, $appVersion, $ip, $platform);
        } catch (UniqueConstraintViolationException) {
            // The same install registered concurrently and won the insert: use its device.
            return $this->register($caller, $token, $installId, $name, $appVersion, $ip, $platform);
        }
    }

    private function register(User $caller, PersonalAccessToken $token, string $installId, string $name, ?string $appVersion, ?string $ip, string $platform): Device
    {
        return DB::transaction(function () use ($caller, $token, $installId, $name, $appVersion, $ip, $platform): Device {
            $device = Device::withTrashed()->where('install_id', $installId)->lockForUpdate()->first();

            if ($device !== null && $device->branch_id !== (int) $caller->branch_id) {
                throw new ConflictException(self::MESSAGE_OTHER_BRANCH);
            }

            // Hardening & Pilot → C: a retired install stays retired until a manager restores it.
            if ($device !== null && ! $device->is_active) {
                throw new AccessDeniedHttpException(self::MESSAGE_RETIRED);
            }

            $created = $device === null;

            if ($created) {
                $device = new Device;
                $device->forceFill([
                    'branch_id' => $caller->branch_id,
                    'install_id' => $installId,
                    'platform' => $platform,
                    // Placeholder until the id is known (the column is NOT NULL and UNIQUE).
                    'code' => '#'.substr($installId, 7),
                    'name' => $name,
                    'is_active' => true,
                ])->save();
            } elseif ($device->trashed()) {
                $device->restore();
            }

            $device->forceFill([
                'code' => $created ? Device::codeFor($device->id, $device->platform) : $device->code,
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
