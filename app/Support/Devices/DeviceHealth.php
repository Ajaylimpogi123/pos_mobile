<?php

namespace App\Support\Devices;

use App\Models\Device;
use App\Support\AppVersion;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * The derived `health` of a device (Hardening & Pilot → C), never stored:
 * - `retired`: the device is retired;
 * - `offline`: last seen over 30 minutes ago (or never);
 * - `attention`: `errors_pending > 0`, and for a tablet also `outbox_failed > 0`, pending
 *   sales older than 30 minutes, an app older than `min_version`, or under 500 MB free;
 * - otherwise `ok`.
 * Web terminals have no outbox and no version gating: only the last-seen rule and
 * `errors_pending` apply.
 */
final class DeviceHealth
{
    public const OK = 'ok';

    public const ATTENTION = 'attention';

    public const OFFLINE = 'offline';

    public const RETIRED = 'retired';

    public const STALE_MINUTES = 30;

    public const MIN_STORAGE_MB = 500;

    public static function of(Device $device, ?CarbonInterface $now = null): string
    {
        $now ??= Carbon::now();
        $stale = $now->copy()->subMinutes(self::STALE_MINUTES);

        if ($device->isRetired()) {
            return self::RETIRED;
        }

        if ($device->last_seen_at === null || $device->last_seen_at->lt($stale)) {
            return self::OFFLINE;
        }

        $heartbeat = $device->last_heartbeat ?? [];

        if ((int) ($heartbeat['errors_pending'] ?? 0) > 0) {
            return self::ATTENTION;
        }

        if ($device->platform === Device::PLATFORM_WEB) {
            return self::OK;
        }

        $oldestPending = isset($heartbeat['oldest_pending_at']) ? Carbon::parse($heartbeat['oldest_pending_at']) : null;
        $pending = $heartbeat['outbox_pending'] ?? null;
        $storage = $heartbeat['storage_free_mb'] ?? null;

        $attention = (int) ($heartbeat['outbox_failed'] ?? 0) > 0
            || ($oldestPending !== null && $oldestPending->lt($stale) && ($pending === null || (int) $pending > 0))
            || AppVersion::compare($device->app_version, AppVersion::info()['min_version']) === -1
            || ($storage !== null && (int) $storage < self::MIN_STORAGE_MB);

        return $attention ? self::ATTENTION : self::OK;
    }
}
