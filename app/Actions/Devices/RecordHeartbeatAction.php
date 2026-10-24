<?php

namespace App\Actions\Devices;

use App\Models\Device;
use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * POST /api/v1/devices/heartbeat (Hardening & Pilot → C): stores the device's last heartbeat
 * (`last_heartbeat`: every `DeviceHeartbeat` field, null when not sent, `printers` [] when not
 * sent) with `last_heartbeat_at`, and updates `last_seen_at`, `app_version` and
 * `last_user_id`. Writes no audit entry.
 */
class RecordHeartbeatAction
{
    /** The `DeviceHeartbeat` keys before `printers`, in the contract's order. */
    public const KEYS = [
        'outbox_pending', 'outbox_failed', 'oldest_pending_at', 'errors_pending',
        'last_catalogue_sync_at', 'last_stock_sync_at', 'storage_free_mb', 'os_version', 'device_model',
    ];

    private const INTEGERS = ['outbox_pending', 'outbox_failed', 'errors_pending', 'storage_free_mb'];

    private const DATES = ['oldest_pending_at', 'last_catalogue_sync_at', 'last_stock_sync_at'];

    /**
     * @param  array<string, mixed>  $data  validated
     */
    public function execute(Device $device, User $caller, array $data): Device
    {
        $now = CarbonImmutable::now();

        $device->forceFill([
            'last_seen_at' => $now,
            'last_heartbeat' => self::heartbeat($data),
            'last_heartbeat_at' => $now,
            'app_version' => (string) $data['app_version'],
            'last_user_id' => $caller->id,
        ])->save();

        return $device;
    }

    /**
     * The stored `DeviceHeartbeat`, in the contract's key order.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public static function heartbeat(array $data): array
    {
        $heartbeat = [];

        foreach (self::KEYS as $key) {
            $value = $data[$key] ?? null;

            $heartbeat[$key] = match (true) {
                $value === null => null,
                in_array($key, self::INTEGERS, true) => (int) $value,
                in_array($key, self::DATES, true) => CarbonImmutable::parse((string) $value)->utc()->toIso8601ZuluString(),
                default => (string) $value,
            };
        }

        $heartbeat['printers'] = array_map(fn (array $printer) => [
            'id' => (int) $printer['id'],
            'ok' => (bool) $printer['ok'],
            'checked_at' => CarbonImmutable::parse((string) $printer['checked_at'])->utc()->toIso8601ZuluString(),
        ], array_values($data['printers'] ?? []));

        return $heartbeat;
    }
}
