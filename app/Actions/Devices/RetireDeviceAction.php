<?php

namespace App\Actions\Devices;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\DeviceHasUnsyncedSalesException;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/admin/devices/{id}/retire (Hardening & Pilot → C, `system.manage`):
 * - a tablet whose last heartbeat reported `outbox_pending > 0`, without `confirm: true` →
 *   409 with `outbox_pending` (a web terminal sells online only, so it never gets the 409);
 * - otherwise sets `is_active = false` and `retired_at`, deletes the tokens bound to it, and
 *   audits `device.retired`.
 * Retiring a device that is already retired changes nothing and writes no audit entry.
 */
class RetireDeviceAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws DeviceHasUnsyncedSalesException
     */
    public function execute(Device $device, bool $confirm, User $actor, ?string $ip): Device
    {
        return DB::transaction(function () use ($device, $confirm, $actor, $ip): Device {
            /** @var Device $device */
            $device = Device::query()->whereKey($device->id)->lockForUpdate()->firstOrFail();

            if ($device->isRetired()) {
                return $device;
            }

            $isWeb = $device->platform === Device::PLATFORM_WEB;
            $pending = $isWeb ? 0 : (int) ($device->last_heartbeat['outbox_pending'] ?? 0);

            if ($pending > 0 && ! $confirm) {
                throw new DeviceHasUnsyncedSalesException(self::conflictMessage($device->code, $pending), $pending);
            }

            $device->forceFill([
                'is_active' => false,
                'retired_at' => CarbonImmutable::now(),
            ])->save();

            $tokens = PersonalAccessToken::query()->where('device_id', $device->id)->delete();

            $this->recordAuditLog->execute(
                action: 'device.retired',
                actor: $actor,
                subject: $device,
                changes: [
                    'code' => $device->code,
                    'name' => $device->name,
                    'outbox_pending' => $pending,
                    'confirmed' => $confirm,
                    'tokens_revoked' => $tokens,
                ],
                ip: $ip,
            );

            return $device;
        });
    }

    /**
     * "T02 still has 5 unsynced sales. Sync it first, or retire it anyway." (`1 unsynced sale`).
     */
    public static function conflictMessage(string $code, int $pending): string
    {
        $sales = $pending === 1 ? '1 unsynced sale' : "{$pending} unsynced sales";

        return "{$code} still has {$sales}. Sync it first, or retire it anyway.";
    }
}
